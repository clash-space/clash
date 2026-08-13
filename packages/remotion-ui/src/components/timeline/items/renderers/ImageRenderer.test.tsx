// @vitest-environment jsdom

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageRenderer } from "./ImageRenderer";

describe("ImageRenderer", () => {
  it("tiles a still thumbnail at its intrinsic ratio instead of stretching it with clip width", () => {
    const { container } = render(
      <ImageRenderer
        item={
          {
            id: "still",
            type: "image",
            src: "/still.png",
            from: 0,
            durationInFrames: 300,
          } as any
        }
        asset={
          {
            id: "still-asset",
            type: "image",
            src: "/still.png",
            createdAt: 1,
          } as any
        }
        width={2_400}
        height={40}
        pixelsPerFrame={8}
      />,
    );

    const thumbnail = container.querySelector(
      "[data-image-thumbnail-renderer]",
    ) as HTMLElement;
    expect(thumbnail.getAttribute("data-image-thumbnail-renderer")).toBe(
      "intrinsic-ratio-tiles",
    );
    expect(thumbnail.style.backgroundRepeat).toBe("repeat-x");
    expect(thumbnail.style.backgroundSize).toBe("auto 100%");
  });

  it("does not turn a storage key into a media route", () => {
    const { container } = render(
      <ImageRenderer
        item={
          {
            id: "still",
            type: "image",
            src: "projects/project/private.png",
            from: 0,
            durationInFrames: 30,
          } as any
        }
        asset={null}
        width={240}
        height={40}
        pixelsPerFrame={8}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("/api/assets/view/");
  });
});
