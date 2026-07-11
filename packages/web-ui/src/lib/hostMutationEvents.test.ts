// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  HOST_MUTATION_EVENT,
  dispatchHostMutationEvent,
} from "./hostMutationEvents";

describe("host mutation browser events", () => {
  it("dispatches project-scoped mutation details for desktop/e2e observers", () => {
    const listener = vi.fn();
    window.addEventListener(HOST_MUTATION_EVENT, listener);

    dispatchHostMutationEvent("project-ui", {
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "node-1" },
      accepted: true,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({
      projectId: "project-ui",
      mutation: {
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: "node-1" },
        accepted: true,
      },
    });
  });
});
