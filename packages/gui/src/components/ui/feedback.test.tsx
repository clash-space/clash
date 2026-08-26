// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FeedbackSurface,
  InlineAlert,
  ToastViewport,
} from "./feedback";

afterEach(() => cleanup());

describe("feedback primitives", () => {
  it.each([
    ["error", "alert", "assertive"],
    ["warning", "status", "polite"],
    ["info", "status", "polite"],
    ["success", "status", "polite"],
  ] as const)(
    "exposes the %s semantic and accessibility contract",
    (tone, role, live) => {
      render(
        <FeedbackSurface tone={tone} density="inline">
          Feedback
        </FeedbackSurface>,
      );

      const feedback = screen.getByText("Feedback");
      expect(feedback).toHaveAttribute("data-ui", "feedback");
      expect(feedback).toHaveAttribute("data-tone", tone);
      expect(feedback).toHaveAttribute("data-density", "inline");
      expect(feedback).toHaveAttribute("role", role);
      expect(feedback).toHaveAttribute("aria-live", live);
      expect(feedback.className).toContain(`bg-[var(--feedback-${tone}-surface)]`);
    },
  );

  it("gives InlineAlert stable title, message, and action slots", () => {
    render(
      <InlineAlert
        tone="warning"
        title="Storage almost full"
        message="Remove unused files."
        action={<button type="button">Review</button>}
      />,
    );

    expect(screen.getByText("Storage almost full")).toHaveAttribute(
      "data-slot",
      "feedback-title",
    );
    expect(screen.getByText("Remove unused files.")).toHaveAttribute(
      "data-slot",
      "feedback-message",
    );
    expect(screen.getByRole("button", { name: "Review" }).parentElement).toHaveAttribute(
      "data-slot",
      "feedback-action",
    );
  });

  it("provides one semantic viewport layer for all transient feedback", () => {
    render(<ToastViewport>Toast</ToastViewport>);

    const viewport = screen.getByText("Toast");
    expect(viewport).toHaveAttribute("data-ui", "toast-viewport");
    expect(viewport.className).toContain("z-[var(--z-toast)]");
  });
});
