import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appState, ensureGlobalConfig, removeHarness, resetEverything, setupHarness } from "../src/app.js";
import { temporaryRoot } from "./helpers.js";

describe("desktop harness lifecycle", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sets up and independently restores detected Claude and Codex harnesses", async () => {
    const root = await temporaryRoot();
    const home = resolve(root, "home");
    const bin = resolve(home, ".local/bin");
    await mkdir(bin, { recursive: true });
    const claude = resolve(bin, "claude");
    const codex = resolve(bin, "codex");
    await writeFile(claude, "#!/bin/sh\necho '2.1.216 (Claude Code)'\n");
    await writeFile(codex, "#!/bin/sh\nif [ \"$1\" = debug ]; then echo '{\"models\":[{\"slug\":\"parent\",\"display_name\":\"Parent\"}]}'; else echo 'codex-cli 0.145.0'; fi\n");
    await chmod(claude, 0o755); await chmod(codex, 0o755);
    const configPath = resolve(home, ".local/share/harness-model-router/config.json");
    await ensureGlobalConfig(configPath, home);

    await setupHarness(configPath, "claude", "/stable/router-helper", home);
    await setupHarness(configPath, "codex", "/stable/router-helper", home);
    const installed = await appState(configPath, home) as any;
    expect(installed.integration).toEqual({ claude: true, codex: true });
    expect(await readFile(resolve(home, ".claude/settings.json"), "utf8")).toContain('/stable/router-helper');
    expect(await readFile(resolve(home, ".codex/hooks.json"), "utf8")).toContain('/stable/router-helper');

    expect((await removeHarness(configPath, "claude") as any).conflicts).toEqual([]);
    const partial = await appState(configPath, home) as any;
    expect(partial.integration).toEqual({ claude: false, codex: true });
    expect((await resetEverything(configPath, home) as any).conflicts).toEqual([]);
    const reset = await appState(configPath, home) as any;
    expect(reset.integration).toEqual({ claude: false, codex: false });
    expect(reset.config.destinations).toEqual({});
  });

  it("does not rewrite a valid config while refreshing app state", async () => {
    const root = await temporaryRoot();
    const home = resolve(root, "home");
    const configPath = resolve(home, ".local/share/harness-model-router/config.json");
    await ensureGlobalConfig(configPath, home);
    const before = await stat(configPath);
    const content = await readFile(configPath, "utf8");
    await appState(configPath, home);
    await appState(configPath, home);
    const after = await stat(configPath);
    expect(await readFile(configPath, "utf8")).toBe(content);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("rolls back first-time Codex setup when catalog capture fails", async () => {
    vi.stubEnv("HMR_TEST_HOME_ONLY", "1");
    const root = await temporaryRoot();
    const home = resolve(root, "home");
    const app = resolve(home, "Applications/Codex.app/Contents");
    await mkdir(app, { recursive: true });
    await writeFile(resolve(app, "Info.plist"), plist("1.2.3"));
    const hooks = resolve(home, ".codex/hooks.json");
    await mkdir(resolve(hooks, ".."), { recursive: true });
    await writeFile(hooks, "{\"hooks\":{\"Existing\":[]}}\n");
    const configPath = resolve(home, ".local/share/harness-model-router/config.json");
    await ensureGlobalConfig(configPath, home);
    const originalConfig = await readFile(configPath, "utf8");

    await expect(setupHarness(configPath, "codex", "/stable/router-helper", home)).rejects.toThrow(/Unable to capture the installed Codex catalog/);

    expect(await readFile(hooks, "utf8")).toBe("{\"hooks\":{\"Existing\":[]}}\n");
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
    await expect(readFile(resolve(home, ".local/share/harness-model-router/install-state.json"), "utf8")).rejects.toThrow();
    await expect(readFile(resolve(home, ".local/share/harness-model-router/codex-source-catalog.json"), "utf8")).rejects.toThrow();
  });

  it("sets up Codex Desktop without a CLI by falling back to its model cache", async () => {
    vi.stubEnv("HMR_TEST_HOME_ONLY", "1");
    const root = await temporaryRoot();
    const home = resolve(root, "home");
    const app = resolve(home, "Applications/Codex.app/Contents");
    await mkdir(app, { recursive: true });
    await writeFile(resolve(app, "Info.plist"), plist("1.2.3"));
    await mkdir(resolve(home, ".codex"), { recursive: true });
    await writeFile(resolve(home, ".codex/models_cache.json"), '{"models":[{"slug":"desktop-parent","display_name":"Desktop Parent"}]}\n');
    const configPath = resolve(home, ".local/share/harness-model-router/config.json");
    await ensureGlobalConfig(configPath, home);

    await setupHarness(configPath, "codex", "/stable/router-helper", home);

    const state = await appState(configPath, home) as any;
    expect(state.detection.codex).toMatchObject({ detected: true, appPath: resolve(home, "Applications/Codex.app"), version: "1.2.3" });
    expect(state.detection.codex.cliPath).toBeUndefined();
    expect(state.integration.codex).toBe(true);
    expect(JSON.parse(await readFile(resolve(home, ".local/share/harness-model-router/codex-source-catalog.json"), "utf8")).models[0].slug).toBe("desktop-parent");
    expect(await readFile(resolve(home, ".codex/hooks.json"), "utf8")).toContain("/stable/router-helper");
  });
});

function plist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`;
}
