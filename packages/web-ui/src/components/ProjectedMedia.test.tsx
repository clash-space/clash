// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectedImage } from "./ProjectedMedia";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Project Asset media rendering", () => {
  it("does not sign or render an object-store key supplied to a product media component", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            url: "https://signed.clash.test/private.webp",
            exp: Math.floor(Date.now() / 1000) + 3_600,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);

    const { container } = render(
      <ProjectedImage
        src="projects/project-1/private.webp"
        alt="Private object"
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });
});
