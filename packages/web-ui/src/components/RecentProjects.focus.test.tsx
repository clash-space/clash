// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

import RecentProjects from "./RecentProjects";

describe("RecentProjects new project focus", () => {
  afterEach(cleanup);

  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("uses an explicit callback instead of querying the first textarea", () => {
    const source = fs.readFileSync("src/components/RecentProjects.tsx", "utf8");

    expect(source).not.toContain("document.querySelector('textarea')");
    expect(source).not.toContain('document.querySelector("textarea")');
  });

  it("delegates new project intent to the owner of the hero composer", () => {
    let calls = 0;
    render(
      <MemoryRouter>
        <RecentProjects projects={[]} onStartNewProject={() => { calls += 1; }} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /start a new project/i }));

    expect(calls).toBe(1);
  });
});
