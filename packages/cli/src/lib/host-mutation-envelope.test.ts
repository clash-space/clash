import test from "node:test";
import assert from "node:assert/strict";
import {
  hostMutationRejected,
  hostMutationSucceeded,
  validateHostMutationEnvelope,
} from "./host-mutation-envelope";

test("host mutation envelope records stale CAS rejection without mutating", () => {
  const result = validateHostMutationEnvelope({
    operation: "update_timeline_state",
    entity: { kind: "timeline", id: "timeline-1" },
    actor: { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" },
    expectedHash: "hash-before",
    currentHash: "hash-current",
    guard: { ok: false, error: "Stale timeline apply rejected" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "Stale timeline apply rejected");
    assert.deepEqual(result.mutation, {
      operation: "update_timeline_state",
      entity: { kind: "timeline", id: "timeline-1" },
      actor: { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" },
      expectedHash: "hash-before",
      beforeHash: "hash-current",
      accepted: false,
      error: "Stale timeline apply rejected",
    });
  }
});

test("host mutation envelope records success and after hash without an override state", () => {
  const accepted = validateHostMutationEnvelope({
    operation: "text_cas_update",
    entity: { kind: "text", id: "script" },
    expectedHash: "hash-before",
    currentHash: "hash-current",
    guard: { ok: true },
  });

  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  assert.deepEqual(
    hostMutationSucceeded(accepted.envelope, {
      resultEntityId: "script",
      afterHash: "hash-after",
    }),
    {
      operation: "text_cas_update",
      entity: { kind: "text", id: "script" },
      expectedHash: "hash-before",
      beforeHash: "hash-current",
      afterHash: "hash-after",
      resultEntityId: "script",
      accepted: true,
    },
  );

  assert.deepEqual(
    hostMutationRejected(accepted.envelope, "checkpoint referenced"),
    {
      operation: "text_cas_update",
      entity: { kind: "text", id: "script" },
      expectedHash: "hash-before",
      beforeHash: "hash-current",
      accepted: false,
      error: "checkpoint referenced",
    },
  );
});

test("host mutation envelope records agent read-token proof", () => {
  const accepted = validateHostMutationEnvelope({
    operation: "canvas_update",
    entity: { kind: "canvas-node", id: "text-1" },
    expectedReadToken: "node-v1:before",
    currentReadToken: "node-v1:before",
    guard: { ok: true },
  });

  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  assert.deepEqual(
    hostMutationSucceeded(accepted.envelope, {
      resultEntityId: "text-1",
      afterReadToken: "node-v1:after",
    }),
    {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      expectedReadToken: "node-v1:before",
      beforeReadToken: "node-v1:before",
      afterReadToken: "node-v1:after",
      resultEntityId: "text-1",
      accepted: true,
    },
  );
});
