/**
 * Redaction pipeline for anything that leaves the local trust boundary:
 * AI prompts and exported reports. Defense in depth - the app should never
 * hold secrets, but if one lands in evidence text it must not propagate.
 */

const PATTERNS: [RegExp, string][] = [
  [/\b(sk|pk)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PEM]"],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [REDACTED]"],
  [/(password|passwd|pwd|secret|token|apikey|api_key|api-key)\s*[:=]\s*[^\s"',;)]{3,}/gi, "$1=[REDACTED]"],
  [/(\bsid|cookie)\s*[:=]\s*[^\s"',;)]{6,}/gi, "$1=[REDACTED]"],
];

export function redact(input: string): string {
  let out = input;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Redact a JSON-serializable structure (deep). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /pass(word)?|secret|token|key/i.test(k) && typeof v === "string" ? "[REDACTED]" : redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
