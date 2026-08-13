// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractiveCanvas } from "../index";

vi.mock("@remotion/player", async () => {
  const ReactModule = await import("react");
  return {
    Player: ReactModule.forwardRef((_props, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getCurrentFrame: vi.fn(() => 0),
        pause: vi.fn(),
        play: vi.fn(),
        seekTo: vi.fn(),
      }));
      return <div />;
    }),
  };
});

vi.mock("react-moveable", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public InteractiveCanvas", () => {
  it("does not turn a selected item storage key into a loadable URL", async () => {
    const loadedSources: string[] = [];
    class ProjectedImageStub {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        loadedSources.push(value);
      }
    }
    vi.stubGlobal("Image", ProjectedImageStub);

    render(
      <InteractiveCanvas
        tracks={
          [
            {
              id: "visuals",
              name: "Visuals",
              items: [
                {
                  id: "private-image",
                  type: "image",
                  src: "projects/project-1/private.png",
                  from: 0,
                  durationInFrames: 30,
                  properties: {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    opacity: 1,
                  },
                },
              ],
            },
          ] as any
        }
        selectedItemId="private-image"
        currentFrame={0}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={30}
        durationInFrames={30}
        onUpdateItem={vi.fn()}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(loadedSources).toEqual([]);
  });
});
