// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AvatarFallback, AvatarRoot } from "./avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("exposes a sized Radix avatar contract", () => {
    render(
      <AvatarRoot aria-label="Minimax" size="lg">
        <AvatarFallback>MM</AvatarFallback>
      </AvatarRoot>,
    );

    const avatar = screen.getByLabelText("Minimax");
    expect(avatar.dataset.slot).toBe("avatar");
    expect(avatar.dataset.size).toBe("lg");
    expect(avatar.className).toContain("group/avatar");
    expect(avatar.querySelector('[data-slot="avatar-fallback"]')).toBeTruthy();
  });
});
