import { routeFor } from "./config.js";
import type { RouteDecision, RouterConfig } from "./types.js";

export function decideClaudeRoute(config: RouterConfig, originalModel: string, agentType?: string): RouteDecision {
  const original = config.harnesses.claude.originalUpstream;
  if (!agentType) return { harness: "claude", routed: false, reason: "main", wireModel: originalModel, upstream: original };
  const route = routeFor(config, "claude", agentType);
  if (!route) return { harness: "claude", agentType, routed: false, reason: "unknown", wireModel: originalModel, upstream: original };
  if (!route.enabled || !config.harnesses.claude.enabled) return { harness: "claude", agentType, routed: false, reason: "disabled", wireModel: originalModel, upstream: original };
  return { harness: "claude", agentType, routed: true, reason: "enabled", wireModel: route.model, upstream: route.upstream };
}

export function decideCodexRoute(config: RouterConfig, requestedModel: string): RouteDecision {
  const original = config.harnesses.codex.originalUpstream;
  const match = Object.entries(config.routes.codex).find(([, route]) => route.alias === requestedModel);
  if (!match) return { harness: "codex", routed: false, reason: "main", wireModel: requestedModel, upstream: original };
  const [agentType, route] = match;
  const preserved = Object.values(config.preserved.customCodexAgents).find((entry) => entry.alias === requestedModel && entry.agentType === agentType);
  if (route.enabled && config.harnesses.codex.enabled) {
    return { harness: "codex", agentType, routed: true, reason: "enabled", wireModel: route.model, upstream: route.upstream, internalAlias: requestedModel };
  }
  if (preserved) {
    return { harness: "codex", agentType, routed: false, reason: "persistent-disabled", wireModel: preserved.originalModel, upstream: original, internalAlias: requestedModel };
  }
  return { harness: "codex", agentType, routed: false, reason: "disabled", wireModel: requestedModel, upstream: original, internalAlias: requestedModel };
}

export function codexHookOutput(config: RouterConfig, toolName: string, input: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!/^(?:Agent|spawn_agent|collaborationspawn_agent|multi_agent_v1\.spawn_agent|functions\.spawn_agent)$/.test(toolName)) return undefined;
  const agentType = input.agent_type;
  if (typeof agentType !== "string") return undefined;
  const route = config.routes.codex[agentType];
  if (!config.harnesses.codex.enabled || !route?.enabled || !route.alias) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...input, model: route.alias },
    },
  };
}
