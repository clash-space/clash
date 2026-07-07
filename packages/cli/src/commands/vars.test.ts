import test from "node:test";
import assert from "node:assert/strict";
import { varsApiErrorMessage } from "./vars";

test("vars 404 explains remote-only compatibility", () => {
  const message = varsApiErrorMessage(
    new Error("API error 404: {\"error\":\"Not found\"}"),
  );

  assert.match(message ?? "", /Remote worker action variables are not available/);
  assert.match(message ?? "", /Local custom actions and local providers do not use `clash vars`/);
});

test("vars non-404 errors keep original handling", () => {
  assert.equal(varsApiErrorMessage(new Error("API error 500: broken")), null);
});
