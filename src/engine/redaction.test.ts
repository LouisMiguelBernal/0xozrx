import { describe, expect, it } from "vitest";
import { redact, redactDeep } from "./redaction";

describe("redact", () => {
  it("hides api keys", () => {
    expect(redact("using sk-live-abcdef1234567890abcd today")).not.toContain("sk-live");
  });

  it("hides aws keys", () => {
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toContain("[REDACTED_AWS_KEY]");
  });

  it("hides pem blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----";
    expect(redact(pem)).toContain("[REDACTED_PEM]");
  });

  it("hides password assignments", () => {
    expect(redact("Password=hunter2! extra")).toContain("[REDACTED]");
    expect(redact("password=hunter2!")).not.toContain("hunter2");
  });
});

describe("redactDeep", () => {
  it("scrubs sensitive keys recursively", () => {
    const out = redactDeep({ a: { token: "abcdefgh1234", note: "ok" }, list: [{ apiKey: "zzz" }] });
    expect(JSON.stringify(out)).not.toContain("abcdefgh1234");
    expect(JSON.stringify(out)).not.toContain('"apiKey":"zzz"');
  });
});
