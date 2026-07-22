import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { atomicWriteFile } from "./files.js";
import type { Protocol, Route, RouterConfig, Upstream } from "./types.js";

export const DEFAULT_CONFIG_NAME = "config.json";

export function defaultConfig(root: string): RouterConfig {
  const dataDir = resolve(root, ".harness-model-router");
  return {
    version: 1,
    gateway: { enabled: true, host: "127.0.0.1", port: 9476, maxBodyBytes: 16 * 1024 * 1024 },
    harnesses: {
      claude: {
        enabled: false,
        originalUpstream: { baseUrl: "https://api.anthropic.com", protocol: "anthropic-messages" },
        mappingTtlMs: 30 * 60 * 1000,
      },
      codex: {
        enabled: false,
        originalUpstream: { baseUrl: "https://api.openai.com/v1", protocol: "openai-responses" },
        hookTimeoutMs: 1_500,
        overlayCatalogPath: resolve(dataDir, "codex-model-catalog.json"),
        parentModels: [],
      },
    },
    routes: { claude: {}, codex: {} },
    preserved: { customCodexAgents: {} },
  };
}

export async function loadConfig(path: string): Promise<RouterConfig> {
  const raw = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const issues = validateConfig(value);
  if (issues.length > 0) throw new Error(`Invalid router configuration:\n- ${issues.join("\n- ")}`);
  return value as RouterConfig;
}

export async function saveConfig(path: string, config: RouterConfig): Promise<void> {
  const issues = validateConfig(config);
  if (issues.length > 0) throw new Error(`Invalid router configuration:\n- ${issues.join("\n- ")}`);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, `${JSON.stringify(config, null, 2)}\n`, 0o600);
}

export function validateConfig(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["configuration must be an object"];
  if (value.version !== 1) issues.push("version must be 1");
  const gateway = value.gateway;
  if (!isRecord(gateway)) issues.push("gateway must be an object");
  else {
    if (typeof gateway.enabled !== "boolean") issues.push("gateway.enabled must be boolean");
    if (gateway.host !== "127.0.0.1" && gateway.host !== "::1" && gateway.host !== "localhost") {
      issues.push("gateway.host must be a localhost address");
    }
    if (!Number.isInteger(gateway.port) || Number(gateway.port) < 1 || Number(gateway.port) > 65535) issues.push("gateway.port must be 1..65535");
    if (!Number.isInteger(gateway.maxBodyBytes) || Number(gateway.maxBodyBytes) < 1024) issues.push("gateway.maxBodyBytes must be an integer >= 1024");
  }
  const harnesses = value.harnesses;
  if (!isRecord(harnesses)) issues.push("harnesses must be an object");
  else {
    validateHarness(harnesses.claude, "claude", "anthropic-messages", issues);
    validateHarness(harnesses.codex, "codex", "openai-responses", issues);
    if (isRecord(harnesses.claude) && (!Number.isFinite(harnesses.claude.mappingTtlMs) || Number(harnesses.claude.mappingTtlMs) < 100)) issues.push("harnesses.claude.mappingTtlMs must be >= 100");
    if (isRecord(harnesses.codex)) {
      if (!Number.isFinite(harnesses.codex.hookTimeoutMs) || Number(harnesses.codex.hookTimeoutMs) < 50 || Number(harnesses.codex.hookTimeoutMs) > 10_000) issues.push("harnesses.codex.hookTimeoutMs must be between 50 and 10000");
      if (!Array.isArray(harnesses.codex.parentModels) || !harnesses.codex.parentModels.every((item) => typeof item === "string" && item.length > 0)) issues.push("harnesses.codex.parentModels must be an array of model slugs");
    }
  }
  const routes = value.routes;
  if (!isRecord(routes)) issues.push("routes must be an object");
  else {
    validateRoutes(routes.claude, "claude", "anthropic-messages", issues);
    validateRoutes(routes.codex, "codex", "openai-responses", issues);
    const codexRoutes = isRecord(routes.codex) ? Object.values(routes.codex) : [];
    const requiresV1 = codexRoutes.some((route) => isRecord(route) && route.enabled === true && route.requiredMultiAgentVersion === "v1");
    const parentModels = isRecord(harnesses) && isRecord(harnesses.codex) ? harnesses.codex.parentModels : undefined;
    if (requiresV1 && (!Array.isArray(parentModels) || parentModels.length === 0)) issues.push("enabled Codex V1 routes require at least one harnesses.codex.parentModels entry");
  }
  if (!isRecord(value.preserved) || !isRecord(value.preserved.customCodexAgents)) issues.push("preserved.customCodexAgents must be an object");
  return issues;
}

function validateHarness(value: unknown, name: string, protocol: Protocol, issues: string[]): void {
  if (!isRecord(value)) return void issues.push(`harnesses.${name} must be an object`);
  if (typeof value.enabled !== "boolean") issues.push(`harnesses.${name}.enabled must be boolean`);
  validateUpstream(value.originalUpstream, `harnesses.${name}.originalUpstream`, protocol, issues);
}

function validateRoutes(value: unknown, harness: string, protocol: Protocol, issues: string[]): void {
  if (!isRecord(value)) return void issues.push(`routes.${harness} must be an object`);
  const aliases = new Set<string>();
  for (const [agent, candidate] of Object.entries(value)) {
    if (!agent.trim()) issues.push(`routes.${harness} has an empty agent name`);
    if (!isRecord(candidate)) {
      issues.push(`routes.${harness}.${agent} must be an object`);
      continue;
    }
    if (typeof candidate.enabled !== "boolean") issues.push(`routes.${harness}.${agent}.enabled must be boolean`);
    if (typeof candidate.model !== "string" || !candidate.model.trim()) issues.push(`routes.${harness}.${agent}.model must be a non-empty string`);
    validateUpstream(candidate.upstream, `routes.${harness}.${agent}.upstream`, protocol, issues);
    if (harness === "codex") {
      if (typeof candidate.alias !== "string" || !/^router-[a-z0-9][a-z0-9-]*$/.test(candidate.alias)) issues.push(`routes.codex.${agent}.alias must match router-[a-z0-9-]+`);
      else if (aliases.has(candidate.alias)) issues.push(`routes.codex alias ${candidate.alias} is duplicated`);
      else aliases.add(candidate.alias);
      if (candidate.requiredMultiAgentVersion !== undefined && candidate.requiredMultiAgentVersion !== "v1") issues.push(`routes.codex.${agent}.requiredMultiAgentVersion supports only v1`);
    } else if (candidate.requiredMultiAgentVersion !== undefined) issues.push(`routes.claude.${agent} cannot require Codex multi-agent metadata`);
  }
}

function validateUpstream(value: unknown, path: string, expected: Protocol, issues: string[]): void {
  if (!isRecord(value)) return void issues.push(`${path} must be an object`);
  if (value.protocol !== expected) issues.push(`${path}.protocol must be ${expected}; cross-protocol translation is unsupported`);
  if (typeof value.baseUrl !== "string") issues.push(`${path}.baseUrl must be a URL`);
  else {
    try {
      const url = new URL(value.baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") issues.push(`${path}.baseUrl must use http or https`);
      if (url.username || url.password) issues.push(`${path}.baseUrl must not contain credentials; use an environment-variable authorization reference`);
      if ([...url.searchParams.keys()].some((key) => /key|token|secret|password/i.test(key))) issues.push(`${path}.baseUrl must not contain credential-like query parameters`);
    } catch {
      issues.push(`${path}.baseUrl must be a valid URL`);
    }
  }
  if (value.authorization !== undefined) {
    if (!isRecord(value.authorization) || typeof value.authorization.env !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.authorization.env)) issues.push(`${path}.authorization.env must be an environment variable name`);
    else if (value.authorization.header !== undefined && (typeof value.authorization.header !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.authorization.header))) issues.push(`${path}.authorization.header is invalid`);
  }
}

export function routeFor(config: RouterConfig, harness: "claude" | "codex", agentType: string): Route | undefined {
  return config.routes[harness][agentType];
}

export function sameUpstream(left: Upstream, right: Upstream): boolean {
  return normalizeBase(left.baseUrl) === normalizeBase(right.baseUrl) && left.protocol === right.protocol;
}

function normalizeBase(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
