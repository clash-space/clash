import test from "node:test";
import assert from "node:assert/strict";
import { resolveCanvasPresenceOptions } from "./canvas";

test("marks spawned agent canvas sync as agent presence", () => {
  assert.deepEqual(resolveCanvasPresenceOptions({
    CLASH_CREW_MEMBER_ID: "local-director",
  }), {
    clientType: "agent",
    agentName: "local-director",
  });
});

test("keeps human CLI canvas sync as cli presence", () => {
  assert.deepEqual(resolveCanvasPresenceOptions({}), {
    clientType: "cli",
  });
});
