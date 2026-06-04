// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectsClient from "@clash/web-ui/components/ProjectsClient";
import { createProject } from "@clash/web-ui/lib/clientActions";

vi.mock("@phosphor-icons/react", () => ({
  Plus: ({ className, ...props }: any) => (
    <span data-testid="plus-icon" className={className} {...props} />
  ),
}));

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  createProject: vi.fn().mockResolvedValue(undefined),
}));

describe("ProjectsClient desktop behavior", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("creates a blank project without using browser prompt", async () => {
    const promptSpy = vi.fn(() => "prompt from browser dialog");
    Object.defineProperty(window, "prompt", {
      configurable: true,
      value: promptSpy,
      writable: true,
    });

    render(<ProjectsClient projects={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /create a new project/i }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("Untitled project", {
        startFromPrompt: false,
      });
    });
    expect(promptSpy).not.toHaveBeenCalled();
  });
});
