import type { Protocol, RouteDecision, RouterConfig } from "./types.js";
import { decideClaudeRoute, decideCodexRoute } from "./routing.js";
import type { ClaudeIdentityStore } from "./identity.js";

export interface AdaptedRequest {
  protocol: Protocol;
  body: Record<string, unknown>;
  decision: RouteDecision;
}

export function adaptAnthropicRequest(
  config: RouterConfig,
  identities: ClaudeIdentityStore,
  headers: Headers,
  body: unknown,
): AdaptedRequest {
  const object = requireRequest(body);
  if (typeof object.model !== "string" || !object.model) throw new Error("Anthropic Messages request requires a string model");
  const sessionId = headers.get("x-claude-code-session-id") ?? undefined;
  const agentId = headers.get("x-claude-code-agent-id") ?? undefined;
  const agentType = identities.resolve(sessionId, agentId);
  const decision = decideClaudeRoute(config, object.model, agentType);
  return { protocol: "anthropic-messages", body: { ...object, model: decision.wireModel }, decision };
}

export function adaptOpenAIRequest(config: RouterConfig, body: unknown): AdaptedRequest {
  const object = requireRequest(body);
  if (typeof object.model !== "string" || !object.model) throw new Error("OpenAI Responses request requires a string model");
  const decision = decideCodexRoute(config, object.model);
  return { protocol: "openai-responses", body: { ...object, model: decision.wireModel }, decision };
}

function requireRequest(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("Request body must be a JSON object");
  return body as Record<string, unknown>;
}

export function protocolForPath(pathname: string): Protocol | undefined {
  if (/\/messages\/?$/.test(pathname)) return "anthropic-messages";
  if (/\/responses\/?$/.test(pathname)) return "openai-responses";
  return undefined;
}

export function upstreamUrl(baseUrl: string, protocol: Protocol, search = ""): URL {
  const url = new URL(baseUrl);
  const resource = protocol === "anthropic-messages" ? "messages" : "responses";
  const normalized = url.pathname.replace(/\/$/, "");
  if (normalized.endsWith(`/${resource}`)) url.pathname = normalized;
  else if (normalized.endsWith("/v1")) url.pathname = `${normalized}/${resource}`;
  else url.pathname = `${normalized}/v1/${resource}`.replace(/\/+/g, "/");
  url.search = search;
  return url;
}
