// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectCard from "./ProjectCard";

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  deleteProject: vi.fn(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({ children, ...props }: { children?: ReactNode }) =>
            React.createElement(tag, props, children),
      },
    ),
  };
});

describe("ProjectCard", () => {
  afterEach(cleanup);

  it("keeps destructive controls outside the project link", () => {
    render(
      <MemoryRouter>
        <ProjectCard
          project={{
            id: "project-1",
            name: "Storyboard draft",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:00.000Z",
            assets: [],
          }}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /storyboard draft/i });
    const deleteButton = screen.getByRole("button", {
      name: /delete project storyboard draft/i,
    });

    expect(link.contains(deleteButton)).toBe(false);
  });
});
