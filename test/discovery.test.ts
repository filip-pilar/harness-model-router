import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../src/discovery.js";
import { temporaryRoot } from "./helpers.js";

describe("agent discovery", () => {
  it("finds built-ins, user/project/plugin Claude agents, and explicit Codex models without modifying files", async () => {
    const root = await temporaryRoot();
    const home = resolve(root, "home");
    const project = resolve(root, "project");
    const paths = {
      claudeUser: resolve(home, ".claude/agents/user-agent.md"),
      claudeProject: resolve(project, ".claude/agents/project-agent.md"),
      claudePlugin: resolve(home, ".claude/plugins/cache/plugin/1.0/agents/plugin-agent.md"),
      claudePluginReadme: resolve(home, ".claude/plugins/cache/plugin/1.0/README.md"),
      codexUser: resolve(home, ".codex/agents/reviewer.toml"),
      codexProject: resolve(project, ".codex/agents/auditor.toml"),
    };
    for (const path of Object.values(paths)) await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(paths.claudeUser, "---\nname: user-agent\ndescription: user\nmodel: sonnet\n---\nPrompt\n");
    await writeFile(paths.claudeProject, "---\nname: project-agent\ndescription: project\n---\nPrompt\n");
    await writeFile(paths.claudePlugin, "---\nname: plugin-agent\ndescription: plugin\n---\nPrompt\n");
    await writeFile(paths.claudePluginReadme, "---\nname: not-an-agent\n---\nDocumentation\n");
    await writeFile(paths.codexUser, 'name = "reviewer"\ndescription = "review"\ndeveloper_instructions = "review"\nmodel = "gpt-custom"\n');
    await writeFile(paths.codexProject, 'name = "auditor"\ndescription = "audit"\ndeveloper_instructions = "audit"\n');
    const result = await discover({ home, project });
    expect(result.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ harness: "claude", name: "Explore", kind: "built-in" }),
      expect.objectContaining({ harness: "claude", name: "user-agent", kind: "user", explicitModel: "sonnet" }),
      expect.objectContaining({ harness: "claude", name: "project-agent", kind: "project" }),
      expect.objectContaining({ harness: "claude", name: "plugin-agent", kind: "plugin" }),
      expect.objectContaining({ harness: "codex", name: "reviewer", kind: "user", explicitModel: "gpt-custom" }),
      expect.objectContaining({ harness: "codex", name: "auditor", kind: "project" }),
    ]));
    expect(result.agents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ harness: "claude", name: "not-an-agent" }),
    ]));
  });
});
