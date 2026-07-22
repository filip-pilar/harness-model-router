const SECRET_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key)$/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_ASSIGNMENT = /\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s,;]+)/gi;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_HEADER.test(key) || /token|secret|password/i.test(key) ? "[REDACTED]" : redact(item)]));
  }
  if (typeof value === "string") return value.replace(BEARER, "$1 [REDACTED]").replace(KEY_ASSIGNMENT, "$1=[REDACTED]");
  return value;
}

export function safeError(error: unknown): string {
  return String(redact(error instanceof Error ? error.message : String(error)));
}
