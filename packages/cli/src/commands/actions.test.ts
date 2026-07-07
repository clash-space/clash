import test from "node:test";
import assert from "node:assert/strict";
import { customActionSecretHint } from "./actions";

test("local custom action secret hint does not point users to remote vars", () => {
  const hint = customActionSecretHint("local");

  assert.match(hint, /local runtime environment/);
  assert.doesNotMatch(hint, /clash vars/);
});

test("remote worker custom action secret hint keeps vars compatibility", () => {
  assert.match(customActionSecretHint("worker"), /clash vars set <KEY>/);
  assert.match(customActionSecretHint(undefined), /clash vars set <KEY>/);
});
