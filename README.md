# harness-model-router

`harness-model-router` is a localhost gateway for routing identifiable Claude Code and Codex subagent requests to protocol-compatible models and endpoints. Main requests, unknown agents, unconfigured agents, and disabled dynamic routes retain their original wire model and final upstream.

The MVP deliberately does not translate protocols. Claude routes must target an Anthropic Messages-compatible endpoint; Codex routes must target an OpenAI Responses-compatible endpoint. Changing a slug or URL cannot make those protocols interchangeable.

## Quick start

### macOS menu app

The native Apple Silicon app owns the gateway, detects Claude Code and Codex, manages reusable destinations and routes, and can surgically set up or restore either harness.

```sh
npm install
npm run build:macos
open "dist/Harness Model Router.app"
```

The app is ad-hoc signed and targets macOS 15 or newer. Its global state lives under `~/.local/share/harness-model-router/`. It never installs Claude Code or Codex and changes harness configuration only after **Set Up Routing** is clicked.

### CLI

Requires Node.js 20 or newer. The CLI uses the same global configuration by default.

```sh
npm install
npm run build
node dist/cli.js init
```

Edit `~/.local/share/harness-model-router/config.json` or use the app. Add routes with the CLI:

```sh
node dist/cli.js route set claude Explore \
  --model claude-compatible-model \
  --endpoint http://127.0.0.1:9001

node dist/cli.js route set codex explorer \
  --alias router-explorer \
  --model responses-compatible-model \
  --endpoint http://127.0.0.1:9002/v1 \
  --multi-agent-version v1
```

For a V1 Codex route, set `harnesses.codex.parentModels` to the exact model slug(s) that may spawn that child. Then validate, inspect, and install:

```sh
node dist/cli.js validate
node dist/cli.js discover
node dist/cli.js install
node dist/cli.js routes
node dist/cli.js catalog
node dist/cli.js start
```

Keep the gateway running in the foreground or under your normal local process supervisor. Users continue launching `claude`, `codex`, and the Codex app normally. Requests fail while either harness points at localhost and the gateway is not running.

Every command accepts `--config <path>`. Discovery, status, routes, catalog, and validation support JSON where shown by `--help` or the examples below.

## Configuration

The generated JSON is user-editable and contains no credentials. A condensed example:

```json
{
  "version": 2,
  "gateway": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 9476,
    "maxBodyBytes": 16777216
  },
  "destinations": {
    "devin": {
      "name": "Devin Bridge",
      "openaiBaseUrl": "http://127.0.0.1:4317/openai/v1",
      "anthropicBaseUrl": "http://127.0.0.1:4317/claude"
    }
  },
  "harnesses": {
    "claude": {
      "enabled": true,
      "originalUpstream": {
        "baseUrl": "https://api.anthropic.com",
        "protocol": "anthropic-messages"
      },
      "mappingTtlMs": 1800000
    },
    "codex": {
      "enabled": true,
      "originalUpstream": {
        "baseUrl": "https://api.openai.com/v1",
        "protocol": "openai-responses"
      },
      "hookTimeoutMs": 1500,
      "parentModels": ["gpt-5.6-sol"],
      "sourceCatalogPath": "/absolute/path/to/source-catalog.json",
      "overlayCatalogPath": "/absolute/path/to/codex-model-catalog.json"
    }
  },
  "routes": {
    "claude": {
      "Explore": { "enabled": true, "model": "swe-1-6-slow", "destination": "devin" }
    },
    "codex": {
      "explorer": { "enabled": true, "alias": "router-explorer", "model": "swe-1-6-slow", "destination": "devin" }
    }
  },
  "preserved": {
    "customCodexAgents": {}
  }
}
```

Each route references a reusable destination and has `enabled` and `model`. Codex routes also have a unique hidden `alias` and may request `requiredMultiAgentVersion: "v1"`. Missing destinations remain representable as visibly broken routes. Version 1 inline-upstream configurations are migrated automatically.

For custom endpoint authorization, reference an environment variable rather than storing a credential:

```json
"authorization": {
  "env": "INDEPENDENT_PROVIDER_KEY",
  "header": "Authorization",
  "scheme": "Bearer"
}
```

End-to-end headers, including authentication and provider-specific fields, are preserved across configured destinations. HTTP transport fields such as `Host`, `Content-Length`, `Connection`, and other hop-by-hop headers are removed or reconstructed. An optional environment-backed authorization reference can override its selected header. Logs and surfaced errors redact common credential fields and bearer/basic values.

## Routing behavior

### Claude Code

Installation adds permanent `SubagentStart` and `SubagentStop` command hooks to the user settings file and points `ANTHROPIC_BASE_URL` at the local gateway. A start event registers `(session_id, agent_id) -> agent_type`; a stop event removes it. The bounded in-memory registry expires stale entries using `mappingTtlMs`, and session IDs prevent concurrent sessions that reuse an agent ID from colliding.

The gateway identifies child Messages requests only through `X-Claude-Code-Session-Id` and `X-Claude-Code-Agent-Id`. A main request has no mapped agent ID and passes through unchanged. The integration neither overwrites nor depends on `CLAUDE_CODE_SUBAGENT_MODEL`.

### Codex

Installation adds a short-timeout `PreToolUse` hook for current spawn-agent tool names, creates a local Responses provider that points to the gateway, and sets `model_catalog_json` to a generated overlay. For an enabled configured `agent_type`, the hook copies the exact spawn arguments and adds a hidden alias as `model`. The catalog makes that alias valid; the gateway replaces it with the real wire model and selects the configured final upstream. Providers never receive the internal alias.

Built-in agents and custom agents without an explicit model use this dynamic rewrite. If the hook fails or times out, Codex retains the original child model and therefore fails open to the original upstream. Unknown agents are never routed as a fallback.

For a custom Codex agent with an explicit top-level `model`, installation records the exact original model line, its byte offset, and file hashes, then normalizes that field to its alias. While enabled the alias selects the custom route. If the route or Codex integration is disabled but remains installed, the gateway resolves the persistent alias to the preserved original model and upstream. Uninstall restores an otherwise unchanged agent file byte-for-byte; a later edit creates a conflict.

### V1 compatibility

Some independent Responses providers need readable V1 multi-agent assignment fields. An enabled route may set `requiredMultiAgentVersion: "v1"`. Its hidden child alias and only the explicitly listed spawning parent catalog entries receive `multi_agent_version: "v1"`. The parent slug, displayed identity, wire model, and upstream remain unchanged; unrelated entries and metadata are preserved.

The overlay disappears on uninstall and is regenerated when routes change. V1 is route-aware compatibility, not a universal requirement. The router rejects `v2` and other unsupported combinations and does not claim that protected V2 assignments are portable to independent providers.

## Discovery and lifecycle

`discover` reads without modifying:

- Claude built-ins plus user, project, and discoverable plugin Markdown agents.
- Codex built-ins plus user and project TOML agents.
- Explicit custom-agent model fields.
- The configured Codex source catalog and its multi-agent metadata.

Useful machine-readable commands:

```sh
node dist/cli.js discover --json
node dist/cli.js status --json
node dist/cli.js routes --json
node dist/cli.js catalog --json
node dist/cli.js validate --json
```

Installation is idempotent, avoids duplicate hooks, writes atomically, and preserves unrelated JSON, TOML, agent, and catalog fields. Restoration state contains owned hook commands, original routing/model scalar lines, byte offsets, and hashes; it does not copy full user files or store API keys. The Codex provider block is copied from the selected original provider so environment-backed header behavior remains intact while its URL changes to localhost.

Installation refuses original base URLs with inline credentials and Codex providers with static credential headers/fields. Convert those values to `env_key`, `env_http_headers`, or the router's environment-variable authorization reference first; this prevents credentials from being duplicated into owned configuration or restoration state.

Uninstall removes only owned hooks and the provider/catalog overlay, restores owned scalar values, and restores normalized agent files:

```sh
node dist/cli.js uninstall
```

If an owned value or normalized agent changed later, uninstall reports a conflict and leaves it alone. Review the edit, then use `uninstall --force` only when replacing that later edit is intentional. `disable claude`, `disable codex`, or `disable all` turns off routing in configuration without uninstalling the integration. Individual routes use `route enable` and `route disable`.

## Limits and verification

- Only Anthropic Messages and OpenAI Responses HTTP requests are supported, including streamed response bodies. Cross-protocol request, tool, response, and stream translation is out of scope.
- Request JSON may be identity, gzip, deflate, Brotli, or zstd encoded. The gateway decodes it to replace the model and forwards uncompressed JSON.
- The gateway binds only to `127.0.0.1`, `::1`, or `localhost`. Headers are routing inputs, not authentication. This project is not a credential manager or an access-control boundary.
- Catalog and hook behavior is version-sensitive and isolated in `catalog.ts`, `hooks.ts`, and `lifecycle.ts`. It was verified against Claude Code 2.1.216 documentation/runtime and Codex CLI 0.145.0; other versions should be validated before relying on them.
- The real Claude Code integration test uses a temporary home and settings root, dummy API key, fresh exact nonce, gateway, and distinct localhost Anthropic-compatible mocks. It drives a real `Agent` spawn, observes the permanent start/stop hooks and verified child headers, checks multi-chunk streaming, then replays the stopped identity to prove cleanup fails open to the original model and upstream.
- The real Codex integration test uses a temporary `CODEX_HOME`, temporary config, a fresh exact nonce, and localhost mock upstreams. It drives a real V1 spawn and proves the parent remains on its original model/upstream while the child uses the hidden alias route.
- Both live tests avoid real user configuration and external model endpoints. Their API keys are deliberately invalid local-only placeholders.

Run all deterministic mock/unit checks and the optional real binary check:

```sh
npm run check
npm run test:live-claude
npm run test:live-codex
npm run test:live
```

Each individual live script sets its opt-in environment flag and skips when its corresponding local binary is absent. `test:live` runs both. External networked provider tests are intentionally absent.

An additional opt-in suite can exercise a locally running Devin Bridge with both real CLIs:

```sh
npm run test:bridge
```

It defaults to `http://127.0.0.1:4317/openai/v1`, `http://127.0.0.1:4317/claude`, and `swe-1-6-slow`. Override those with `HMR_DEVIN_OPENAI_URL`, `HMR_DEVIN_CLAUDE_URL`, and `HMR_DEVIN_MODEL`. This suite contacts the configured local provider and may encounter its entitlement, rate-limit, or content-policy behavior; it still uses temporary harness homes and dummy credentials.

## Embedding

The package root exports configuration validation, identity storage, route decisions, protocol adapters, catalog overlay generation, discovery, lifecycle utilities, and gateway construction. Those modules do not depend on the CLI and are intended to be reusable by a future desktop application without putting application concerns into the routing core.

Current hook and configuration schemas were checked against the official [Codex hooks documentation](https://developers.openai.com/codex/hooks), [Codex subagents documentation](https://developers.openai.com/codex/subagents), [Claude Code hooks reference](https://code.claude.com/docs/en/hooks), and [Claude Code environment variables](https://code.claude.com/docs/en/env-vars).
