import { describe, expect, it } from "vitest";

import {
  hostMutationRejected,
  hostMutationSucceeded,
  validateHostMutationEnvelope,
} from "./host-mutation-envelope";

describe("host mutation envelope", () => {
  it("records CAS and read-token preconditions in the same host contract", () => {
    const accepted = validateHostMutationEnvelope({
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      expectedHash: "hash-before",
      currentHash: "hash-before",
      expectedReadToken: "node-v1:before",
      currentReadToken: "node-v1:before",
      force: false,
      guard: { ok: true },
    });

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    expect(hostMutationSucceeded(accepted.envelope, {
      resultEntityId: "text-1",
      afterHash: "hash-after",
      afterReadToken: "node-v1:after",
    })).toEqual({
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "text-1" },
      expectedHash: "hash-before",
      beforeHash: "hash-before",
      expectedReadToken: "node-v1:before",
      beforeReadToken: "node-v1:before",
      afterHash: "hash-after",
      afterReadToken: "node-v1:after",
      resultEntityId: "text-1",
      forced: false,
      accepted: true,
    });
  });

  it("returns rejected mutation evidence without mutating", () => {
    const rejected = validateHostMutationEnvelope({
      operation: "text_cas_update",
      entity: { kind: "text", id: "script" },
      expectedHash: "hash-before",
      currentHash: "hash-current",
      force: true,
      guard: { ok: false, error: "Stale text apply rejected" },
    });

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;

    expect(rejected.mutation).toEqual({
      operation: "text_cas_update",
      entity: { kind: "text", id: "script" },
      expectedHash: "hash-before",
      beforeHash: "hash-current",
      forced: true,
      accepted: false,
      error: "Stale text apply rejected",
    });
    expect(hostMutationRejected(rejected.mutation, "checkpoint referenced")).toEqual({
      operation: "text_cas_update",
      entity: { kind: "text", id: "script" },
      expectedHash: "hash-before",
      beforeHash: "hash-current",
      forced: true,
      accepted: false,
      error: "checkpoint referenced",
    });
  });
});
