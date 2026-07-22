import { readdir, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type { DiscoveredAgent, DiscoveryResult, RouterConfig } from "./types.js";
import type { ModelCatalog } from "./catalog.js";
import { exists } from "./files.js";

const CLAUDE_BUILT_INS = ["general-purpose", "Explore", "Plan"];
const CODEX_BUILT_INS = ["default", "worker", "explorer"];

export interface DiscoveryOptions {
  home: string;
  project: string;
  config?: RouterConfig;
}

export async function discover(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const agents: DiscoveredAgent[] = [
    ...CLAUDE_BUILT_INS.map((name): DiscoveredAgent => ({ harness: "claude", name, kind: "built-in" })),
    ...CODEX_BUILT_INS.map((name): DiscoveredAgent => ({ harness: "codex", name, kind: "built-in" })),
  ];
  await discoverClaudeDirectory(resolve(options.home, ".claude/agents"), "user", agents);
  await discoverClaudeDirectory(resolve(options.project, ".claude/agents"), "project", agents);
  await discoverClaudePlugins(resolve(options.home, ".claude/plugins"), agents);
  await discoverCodexDirectory(resolve(options.home, ".codex/agents"), "user", agents);
  await discoverCodexDirectory(resolve(options.project, ".codex/agents"), "project", agents);
  const catalogPath = options.config?.harnesses.codex.sourceCatalogPath;
  const result: DiscoveryResult = { agents: deduplicate(agents) };
  if (catalogPath && await exists(catalogPath)) {
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as ModelCatalog;
    result.codexCatalog = {
      path: catalogPath,
      models: catalog.models.map((model) => ({ slug: model.slug, ...(model.multi_agent_version ? { multiAgentVersion: model.multi_agent_version } : {}), ...(model.visibility ? { visibility: model.visibility } : {}) })),
    };
  }
  return result;
}

async function discoverClaudeDirectory(directory: string, kind: "user" | "project" | "plugin", output: DiscoveredAgent[]): Promise<void> {
  for (const path of await filesUnder(directory, ".md", kind === "plugin" ? 6 : 1)) {
    try {
      const content = await readFile(path, "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
      const metadata = frontmatter ? parseYaml(frontmatter) as Record<string, unknown> : {};
      const name = typeof metadata.name === "string" ? metadata.name : basename(path, ".md");
      output.push({ harness: "claude", name, kind, path, ...(typeof metadata.model === "string" ? { explicitModel: metadata.model } : {}) });
    } catch { /* malformed agents are discoverable only after users fix them */ }
  }
}

async function discoverClaudePlugins(directory: string, output: DiscoveredAgent[]): Promise<void> {
  await discoverClaudeDirectory(directory, "plugin", output);
}

async function discoverCodexDirectory(directory: string, kind: "user" | "project", output: DiscoveredAgent[]): Promise<void> {
  for (const path of await filesUnder(directory, ".toml", 1)) {
    try {
      const metadata = parseToml(await readFile(path, "utf8")) as Record<string, unknown>;
      const name = typeof metadata.name === "string" ? metadata.name : basename(path, ".toml");
      output.push({ harness: "codex", name, kind, path, ...(typeof metadata.model === "string" ? { explicitModel: metadata.model } : {}) });
    } catch { /* validation reports malformed files elsewhere */ }
  }
}

async function filesUnder(directory: string, extension: string, depth: number): Promise<string[]> {
  if (depth < 0 || !await exists(directory)) return [];
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(path, extension, depth - 1));
    else if (entry.isFile() && extname(entry.name) === extension) output.push(path);
  }
  return output;
}

function deduplicate(agents: DiscoveredAgent[]): DiscoveredAgent[] {
  const seen = new Set<string>();
  return agents.filter((agent) => {
    const key = `${agent.harness}:${agent.kind}:${agent.path ?? agent.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
