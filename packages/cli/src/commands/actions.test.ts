import test from "node:test";
import assert from "node:assert/strict";
import { customActionSecretHint } from "./actions";

test("local custom action secret hint does not point users to remote vars", () => {
  const hint = customActionSecretHint("local");

  assert.match(hint, /local runtime environment/);
  assert.doesNotMatch(hint, /clash vars/);
});

test("remote worker custom action secret hint does not point to removed local vars CLI", () => {
  assert.match(customActionSecretHint("worker"), /hosted\/remote Settings/);
  assert.match(customActionSecretHint(undefined), /hosted\/remote Settings/);
  assert.doesNotMatch(customActionSecretHint("worker"), /clash vars/);
  assert.doesNotMatch(customActionSecretHint(undefined), /clash vars/);
});
