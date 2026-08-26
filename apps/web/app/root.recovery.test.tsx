// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const routeError = new TypeError(
  "Failed to fetch dynamically imported module: http://localhost:3000/app/routes/home.tsx",
);

vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return {
    ...original,
    useRouteError: () => routeError,
  };
});

import { ErrorBoundary } from "./root";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("route error recovery", () => {
  it("shows bounded renderer recovery instead of committing a failed chunk surface", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));

    render(
      <MemoryRouter>
        <ErrorBoundary />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("status", { name: "Reconnecting Clash" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: "Clash could not finish this view",
      }),
    ).toBeNull();
  });
});
