import test from "node:test";
import assert from "node:assert/strict";
import { assertAgentHostWritePath } from "./agent-host-write";

test("agent host write guard always rejects no-host writes", () => {
  const rejected = assertAgentHostWritePath({
    actorClientType: "agent",
    operation: "timeline apply",
    readCommand: "clash timeline pull --json",
  });

  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.match(rejected.error, /local host.*cwd observation/);
    assert.match(rejected.error, /Start the local-api host/);
    assert.match(rejected.error, /clash timeline pull --json/);
    assert.doesNotMatch(rejected.error, /readToken|with that token/i);
    assert.doesNotMatch(rejected.error, /--force/);
  }

  assert.deepEqual(
    assertAgentHostWritePath({
      actorClientType: "cli",
      operation: "timeline apply",
      readCommand: "clash timeline pull --json",
    }),
    { ok: true },
  );
});
