import test from "node:test";
import assert from "node:assert/strict";
import { redactApiKeyForDisplay } from "./auth";

test("auth status redacts saved API keys without exposing the full secret", () => {
  const token = "clsh_super_secret_middle_abcdef";
  const redacted = redactApiKeyForDisplay(token);

  assert.equal(redacted, "clsh_...cdef");
  assert.ok(!redacted.includes(token));
  assert.ok(!redacted.includes("super_secret_middle"));
});

test("auth status redacts short or non-standard tokens", () => {
  assert.equal(redactApiKeyForDisplay("secret"), "secr...");
  assert.equal(redactApiKeyForDisplay("sk-provider-secret-1234"), "sk-p...1234");
  assert.equal(redactApiKeyForDisplay("   "), "[redacted]");
});
