import type { Upstream } from "./types.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function forwardedHeaders(source: Headers, _original: Upstream, target: Upstream, env: NodeJS.ProcessEnv = process.env): Headers {
  const output = new Headers();
  const connectionTokens = new Set((source.get("connection") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || connectionTokens.has(lower) || lower === "host" || lower === "content-length") continue;
    output.set(name, value);
  }
  output.delete("content-encoding");
  if (target.authorization) {
    const value = env[target.authorization.env];
    if (!value) throw new Error(`Authorization environment variable ${target.authorization.env} is not set`);
    output.set(target.authorization.header ?? "Authorization", target.authorization.scheme ? `${target.authorization.scheme} ${value}` : value);
  }
  return output;
}

export function responseHeaders(source: Headers): Headers {
  const output = new Headers();
  const connectionTokens = new Set((source.get("connection") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && !connectionTokens.has(lower) && lower !== "content-length") output.set(name, value);
  }
  output.delete("content-encoding");
  return output;
}
