// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HydrateFallback, RouteModuleRecoveryFallback } from "./root";

afterEach(cleanup);

describe("HydrateFallback", () => {
  it("identifies startup as Clash connecting instead of an anonymous spinner", () => {
    const { container } = render(<HydrateFallback />);

    expect(screen.getByRole("status", { name: "Opening Clash" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Clash is opening" })).toBeTruthy();
    expect(
      container.querySelector('[data-agent-motion-state="connecting"]'),
    ).toBeTruthy();
  });

  it("identifies a temporary route-module restart as renderer recovery", () => {
    const { container } = render(<RouteModuleRecoveryFallback />);

    expect(
      screen.getByRole("status", { name: "Reconnecting Clash" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Clash renderer is reconnecting" }),
    ).toBeTruthy();
    expect(screen.getByText("Reconnecting the desktop renderer…")).toBeTruthy();
    expect(
      container.querySelector('[data-agent-motion-state="connecting"]'),
    ).toBeTruthy();
  });
});
