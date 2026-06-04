import test from "node:test";
import assert from "node:assert/strict";
import { buildActionsHostEnv } from "./daemon";

test("actions host follows the active daemon server instead of stale bridge credentials", () => {
  const env = buildActionsHostEnv("project-1", "http://127.0.0.1:49321", "local-test-key", {
    runtimeId: "runtime-1",
    apiKey: "persisted-agent-key",
    serverUrl: "http://localhost:3001",
  });

  assert.deepEqual(env, {
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "local-test-key",
    runtimeId: "runtime-1",
    projectId: "project-1",
  });
});
