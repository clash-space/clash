// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentMotion } from "./AgentMotion";

describe("AgentMotion", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exposes the Clash avatar identity and semantic runtime state", () => {
    const { container } = render(
      <AgentMotion state="review" decorative={false} label="Reviewing agent" />,
    );

    const avatar = container.querySelector('[data-slot="clash-agent-avatar"]');
    expect(avatar).toBeTruthy();
    expect(avatar?.getAttribute("data-status")).toBe("review");
    expect(avatar?.getAttribute("role")).toBe("img");
    expect(avatar?.getAttribute("aria-label")).toBe("Reviewing agent");
  });

  it("tracks the pointer with CSS eye offsets instead of React state", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    const { container } = render(<AgentMotion />);
    const root = container.querySelector(".clash-agent-motion") as HTMLElement;
    expect(root).toBeTruthy();

    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 180,
      bottom: 180,
      width: 80,
      height: 80,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerMove(root, { clientX: 180, clientY: 120, pointerType: "mouse" });
    fireEvent.pointerMove(root, { clientX: 190, clientY: 130, pointerType: "mouse" });

    await waitFor(() => {
      expect(root.dataset.agentMotionTracking).toBe("true");
      expect(root.style.getPropertyValue("--clash-agent-eye-x")).not.toBe("0px");
      expect(root.style.getPropertyValue("--clash-agent-eye-y")).not.toBe("0px");
    });
  });

  it("uses an external gaze target only while idle", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const { container, rerender } = render(<AgentMotion gazeTarget={{ x: 180, y: 120 }} />);
    const root = container.querySelector(".clash-agent-motion") as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 180,
      bottom: 180,
      width: 80,
      height: 80,
      toJSON: () => ({}),
    } as DOMRect);

    rerender(<AgentMotion gazeTarget={{ x: 180, y: 120 }} />);

    await waitFor(() => {
      expect(root.dataset.agentMotionTracking).toBe("true");
      expect(root.style.getPropertyValue("--clash-agent-eye-x")).not.toBe("0px");
    });

    root.dataset.agentMotionTracking = "false";
    root.style.setProperty("--clash-agent-eye-x", "0px");
    root.style.setProperty("--clash-agent-eye-y", "0px");

    rerender(<AgentMotion state="working" gazeTarget={{ x: 180, y: 120 }} />);

    expect(root.dataset.agentMotionTracking).toBe("false");
    expect(root.style.getPropertyValue("--clash-agent-eye-x")).toBe("0px");
    expect(root.style.getPropertyValue("--clash-agent-eye-y")).toBe("0px");
  });
});
