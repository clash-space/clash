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

  it("uses the Clash wordmark with a brand-colored C", () => {
    const { container, getByLabelText } = render(<LandingNav />);

    expect(getByLabelText("Clash")).toBeTruthy();
    const c = container.querySelector(".clash-wordmark-c");
    expect(c).toBeTruthy();
    expect(c?.className).toContain("text-brand");
    expect(c?.textContent).toBe("C");
    expect(container.querySelector(".clash-wordmark-rest")?.textContent).toBe(
      "lash",
    );
    expect(container.querySelector('img[src*="/brand/logo-mark"]')).toBeNull();
  });
});
