// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppFeedbackProvider } from "./AppFeedback";
import { useActivityToasts } from "./ActivityToast";

function ActivityTrigger() {
  const { addToast } = useActivityToasts();
  return (
    <button
      type="button"
      onClick={() =>
        addToast({
          type: "activity",
          actor: { clientType: "agent", name: "Mira" },
          action: "updated",
          nodeId: "node-1",
          nodeType: "image",
          label: "Cover",
          timestamp: 42,
        })
      }
    >
      Emit activity
    </button>
  );
}

afterEach(() => cleanup());

describe("activity feedback adapter", () => {
  it("routes collaboration activity into the global feedback viewport", () => {
    render(
      <AppFeedbackProvider>
        <ActivityTrigger />
      </AppFeedbackProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Emit activity" }));

    const title = screen.getByText("Mira edited Cover");
    expect(title.closest('[data-ui="toast-viewport"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-ui="toast-viewport"]')).toHaveLength(1);
  });
});
