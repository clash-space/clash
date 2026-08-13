import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readComponent(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

describe("InteractiveCanvas primitives", () => {
  it("uses the gesture primitive instead of buttons for the minimap", () => {
    const source = readComponent("InteractiveCanvas.tsx");

    expect(source).toContain("minimapGestureBind");
    expect(source).not.toContain("<RemotionIconButton");
    expect(source).not.toContain("<button");
  });

  it("routes canvas pan gestures through the gesture primitive", () => {
    const source = readComponent("InteractiveCanvas.tsx");

    expect(source).toContain("./ui/gesture");
    expect(source).toContain("useDragGesture");
    expect(source).not.toContain(
      "window.addEventListener('mousemove', handlePanMove",
    );
    expect(source).not.toContain(
      "window.removeEventListener('mousemove', handlePanMove",
    );
  });

  it("routes canvas item transform gestures through the gesture primitive", () => {
    const source = readComponent("InteractiveCanvas.tsx");

    expect(source).toContain("canvasTransformGestureBind");
    expect(source).not.toContain(
      "window.addEventListener('mousemove', handleMouseMove",
    );
    expect(source).not.toContain(
      "window.removeEventListener('mousemove', handleMouseMove",
    );
    expect(source).not.toContain(
      "window.addEventListener('mouseup', handleMouseUp",
    );
    expect(source).not.toContain(
      "window.removeEventListener('mouseup', handleMouseUp",
    );
  });

  it("zooms the preview with an unmodified mouse wheel", () => {
    const source = readComponent("InteractiveCanvas.tsx");
    const wheelHandler = source.slice(
      source.indexOf("const handleWheel"),
      source.indexOf("// \u7ed1\u5b9a\u6eda\u8f6e\u4e8b\u4ef6"),
    );

    expect(wheelHandler).toContain("e.preventDefault()");
    expect(wheelHandler).toContain("setZoom");
    expect(wheelHandler).not.toContain("if (e.metaKey || e.ctrlKey)");
  });

  it("samples live media audio without changing player volume", () => {
    const source = readComponent("InteractiveCanvas.tsx");

    expect(source).toContain("captureStream");
    expect(source).toContain("getFloatTimeDomainData");
    expect(source).toContain("onAudioLevelsChange?.(next)");
    expect(source).not.toContain("player.setVolume");
    expect(source).not.toContain("player.mute()");
    expect(source).not.toContain("player.unmute()");
  });
});
