// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePageClient from "./HomePageClient";
import { createProject } from "@clash/web-ui/lib/clientActions";

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  createProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./HeroSection", async () => {
  return {
    default: () => <div data-testid="hero-section" />,
  };
});

vi.mock("./RecentProjects", () => ({
  default: ({ onCreateProject }: { onCreateProject?: (name: string) => void }) => (
    <button type="button" onClick={() => onCreateProject?.("Homepage project")}>
      Create project
    </button>
  ),
}));

describe("HomePageClient new project creation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("creates directly from Recent Projects without sending the user to the hero composer", async () => {
    render(<HomePageClient initialProjects={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("Homepage project", {
        startFromPrompt: false,
      });
    });
  });
});
