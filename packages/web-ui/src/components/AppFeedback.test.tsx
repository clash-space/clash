// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppFeedbackProvider, useAppFeedback } from "./AppFeedback";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      animate: _animate,
      exit: _exit,
      initial: _initial,
      transition: _transition,
      ...props
    }: ComponentProps<"div"> & {
      animate?: unknown;
      exit?: unknown;
      initial?: unknown;
      transition?: unknown;
    }) => <div {...props} />,
  },
  useReducedMotion: () => false,
}));

function Trigger({ variant }: { variant: "error" | "warning" | "info" | "success" }) {
  const feedback = useAppFeedback();
  return (
    <button
      type="button"
      onClick={() => feedback.notify({ title: `${variant} title`, variant })}
    >
      Show {variant}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AppFeedbackProvider", () => {
  it("renders every toast through the shared feedback viewport and surface", () => {
    render(
      <AppFeedbackProvider>
        <Trigger variant="warning" />
      </AppFeedbackProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show warning" }));

    expect(screen.getByText("warning title").closest('[data-ui="feedback"]')).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(screen.getByText("warning title").closest('[data-ui="toast-viewport"]')).not.toBeNull();
  });

  it("keeps errors until dismissal but expires informational feedback", () => {
    vi.useFakeTimers();
    render(
      <AppFeedbackProvider>
        <Trigger variant="error" />
        <Trigger variant="info" />
      </AppFeedbackProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show error" }));
    fireEvent.click(screen.getByRole("button", { name: "Show info" }));

    act(() => vi.advanceTimersByTime(5_500));

    expect(screen.getByText("error title")).toBeInTheDocument();
    expect(screen.queryByText("info title")).not.toBeInTheDocument();
  });

  it("pauses an expiring toast while the pointer is over it", () => {
    vi.useFakeTimers();
    render(
      <AppFeedbackProvider>
        <Trigger variant="success" />
      </AppFeedbackProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show success" }));
    const toast = screen.getByText("success title").closest('[data-ui="feedback"]');
    expect(toast).not.toBeNull();

    fireEvent.mouseEnter(toast!);
    act(() => vi.advanceTimersByTime(8_000));
    expect(screen.getByText("success title")).toBeInTheDocument();

    fireEvent.mouseLeave(toast!);
    act(() => vi.advanceTimersByTime(5_500));
    expect(screen.queryByText("success title")).not.toBeInTheDocument();
  });
});
