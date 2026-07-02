// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePageClient from "./HomePageClient";

const heroFocus = vi.hoisted(() => vi.fn());

vi.mock("./HeroSection", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => ({
        focus: heroFocus,
      }));
      return <div data-testid="hero-section" />;
    }),
  };
});

vi.mock("./RecentProjects", () => ({
  default: ({ onStartNewProject }: { onStartNewProject?: () => void }) => (
    <button type="button" onClick={onStartNewProject}>
      Start tile
    </button>
  ),
}));

describe("HomePageClient new project focus", () => {
  afterEach(() => {
    cleanup();
    heroFocus.mockClear();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("routes the recent-projects start tile to the hero composer focus handle", () => {
    render(<HomePageClient initialProjects={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Start tile" }));

    expect(heroFocus).toHaveBeenCalledTimes(1);
  });
});
