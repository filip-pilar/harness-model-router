import { codexHookOutput } from "./routing.js";
import type { ClaudeHookInput, CodexPreToolInput, RouterConfig } from "./types.js";

export async function deliverClaudeHook(config: RouterConfig, input: ClaudeHookInput, fetchImpl: typeof fetch = fetch): Promise<void> {
  const action = input.hook_event_name === "SubagentStart" ? "start" : "stop";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.harnesses.codex.hookTimeoutMs);
  try {
    const response = await fetchImpl(`http://${config.gateway.host}:${config.gateway.port}/__router/claude/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Gateway hook endpoint returned ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function runCodexPreToolHook(config: RouterConfig, input: CodexPreToolInput): Record<string, unknown> | undefined {
  if (input.hook_event_name !== "PreToolUse" || typeof input.tool_name !== "string" || typeof input.tool_input !== "object" || input.tool_input === null) return undefined;
  return codexHookOutput(config, input.tool_name, input.tool_input);
}
