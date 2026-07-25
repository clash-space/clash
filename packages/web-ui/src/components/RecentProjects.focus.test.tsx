// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { join } from "node:path";

import RecentProjects from "./RecentProjects";

describe("RecentProjects new project creation", () => {
  afterEach(cleanup);

  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("uses an explicit callback instead of querying the first textarea", () => {
    const source = fs.readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/RecentProjects.tsx"),
      "utf8",
    );

    expect(source).not.toContain("document.querySelector('textarea')");
    expect(source).not.toContain('document.querySelector("textarea")');
  });

  it("delegates the entered project name to its owner", async () => {
    const onCreateProject = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <RecentProjects projects={[]} onCreateProject={onCreateProject} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /start a new project/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /project name/i }), {
      target: { value: "Storyboard" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateProject).toHaveBeenCalledWith("Storyboard");
  });
});
