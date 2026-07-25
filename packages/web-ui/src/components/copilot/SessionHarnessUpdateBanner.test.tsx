// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionHarnessUpdateBanner } from "./SessionHarnessUpdateBanner";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_target, tag: string) => ({ children, ...props }: { children?: ReactNode }) => {
        const safeProps = Object.fromEntries(Object.entries(props).filter(([key]) => ![
          "initial", "animate", "exit", "transition", "layout",
        ].includes(key)));
        return React.createElement(tag, safeProps, children);
      },
    }),
  };
});

describe("SessionHarnessUpdateBanner", () => {
  afterEach(cleanup);

  it("fits inside a caller-defined push point without shrinking the message list", () => {
    render(
      <SessionHarnessUpdateBanner
        status={{
          session_id: "session-overlay",
          harness_id: "codex-acp",
          harness_label: "Codex",
          running_version: "1.0.1",
          installed_version: "1.0.2",
          restart_required: true,
          busy: false,
          restart_pending: false,
        }}
        phase="idle"
        busy={false}
        onRestart={vi.fn()}
      />,
    );

    const banner = screen.getByRole("status");
    expect(banner.className).not.toContain("absolute");
    expect(banner.className).not.toContain("shrink-0");
  });

  it("offers an in-session restart after a newer harness is installed", () => {
    const onRestart = vi.fn();
    render(
      <SessionHarnessUpdateBanner
        status={{
          session_id: "session-one",
          harness_id: "codex-acp",
          harness_label: "Codex",
          running_version: "1.0.1",
          installed_version: "1.0.2",
          restart_required: true,
          busy: false,
          restart_pending: false,
        }}
        phase="idle"
        busy={false}
        onRestart={onRestart}
      />,
    );

    expect(screen.getByText("Codex 1.0.2 installed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart session" }));
    expect(onRestart).toHaveBeenCalledWith("now");
  });

  it("dismisses the current update notice without restarting the session", () => {
    const onRestart = vi.fn();
    render(
      <SessionHarnessUpdateBanner
        status={{
          session_id: "session-dismiss",
          harness_id: "codex-acp",
          harness_label: "Codex",
          running_version: "1.0.1",
          installed_version: "1.0.2",
          restart_required: true,
          busy: false,
          restart_pending: false,
        }}
        phase="idle"
        busy={false}
        onRestart={onRestart}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss ACP update notice" }));

    expect(screen.queryByText("Codex 1.0.2 installed")).toBeNull();
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("queues a busy session restart for the end of the current turn", () => {
    const onRestart = vi.fn();
    render(
      <SessionHarnessUpdateBanner
        status={{
          session_id: "session-two",
          harness_id: "codex-acp",
          harness_label: "Codex",
          installed_version: "1.0.2",
          restart_required: true,
          busy: true,
          restart_pending: false,
        }}
        phase="idle"
        busy
        onRestart={onRestart}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart after this turn" }));
    expect(onRestart).toHaveBeenCalledWith("after-turn");
  });
});
