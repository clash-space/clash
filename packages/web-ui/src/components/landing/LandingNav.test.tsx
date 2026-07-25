// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LandingNav from "./LandingNav";

vi.mock("react-router", () => ({
  Link: ({ to, className, children }: { to: string; className?: string; children: ReactNode }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@clash/web-ui/lib/betterAuthClient", () => ({
  default: {
    useSession: () => ({ data: null }),
  },
}));

describe("LandingNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the shared lightweight control surface", () => {
    const { container } = render(<LandingNav />);

    const headerSurface = container.querySelector(".clash-landing-header");
    expect(headerSurface).toBeTruthy();
    expect(headerSurface?.className).toContain("clash-control-surface");
  });

  it("uses the current Clash agent logo", () => {
    const { container, getByLabelText } = render(<LandingNav />);

    expect(getByLabelText("Clash")).toBeTruthy();
    expect(
      container.querySelector('img[src="/brand/logo-mark.svg"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('img[src="/brand/logo-mark-dark.svg"]'),
    ).toBeTruthy();
    expect(container.querySelector(".clash-wordmark-slash")).toBeNull();
  });
});
