import test from "node:test";
import assert from "node:assert/strict";
import { assertAgentHostWritePath } from "./agent-host-write";

test("agent host write guard rejects no-host writes unless forced", () => {
  const rejected = assertAgentHostWritePath({
    actorClientType: "agent",
    operation: "timeline apply",
    readCommand: "clash timeline pull --json",
  });

  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.match(rejected.error, /host-verified read receipt/);
    assert.match(rejected.error, /clash canvas connect/);
    assert.match(rejected.error, /clash timeline pull --json/);
    assert.match(rejected.error, /--force/);
  }

  assert.deepEqual(
    assertAgentHostWritePath({
      actorClientType: "agent",
      operation: "timeline apply",
      readCommand: "clash timeline pull --json",
      force: true,
    }),
    { ok: true },
  );
  assert.deepEqual(
    assertAgentHostWritePath({
      actorClientType: "cli",
      operation: "timeline apply",
      readCommand: "clash timeline pull --json",
    }),
    { ok: true },
  );
});
