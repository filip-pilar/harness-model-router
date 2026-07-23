#!/usr/bin/env node
/* global process */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { output: { type: "string", short: "o" }, target: { type: "string" } }, strict: true });
const output = resolve(values.output || join(root, "dist", "harness-model-router-helper"));
mkdirSync(dirname(output), { recursive: true });

for (const [command, args] of [
  ["npm", ["run", "build"]],
  ["bun", ["build", join(root, "dist", "cli.js"), "--compile", `--target=${values.target || "bun-darwin-arm64"}`, `--outfile=${output}`]],
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
chmodSync(output, 0o755);
process.stdout.write(`${output}\n`);
