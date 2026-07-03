import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");

describe("VideoClipper timeline primitives", () => {
    it("uses the shared Radix-backed slider primitive instead of a hand-rolled timeline slider", () => {
        const source = readSource("packages/web-ui/src/components/VideoClipperContext.tsx");

        expect(source).toContain("./ui/slider");
        expect(source).toContain("Slider");
        expect(source).toContain("SliderTrack");
        expect(source).toContain("SliderThumb");
        expect(source).not.toContain('role="slider"');
        expect(source).not.toContain("window.addEventListener('mousemove'");
        expect(source).not.toContain("window.addEventListener('mouseup'");
        expect(source).not.toContain("setDrag('playhead'");
        expect(source).not.toContain("setDrag('start'");
        expect(source).not.toContain("setDrag('end'");
    });

    it("uses the shared Radix-backed toggle group for mode selection", () => {
        const source = readSource("packages/web-ui/src/components/VideoClipperContext.tsx");

        expect(source).toContain("./ui/toggle-group");
        expect(source).toContain("ToggleGroup");
        expect(source).toContain("ToggleGroupItem");
        expect(source).not.toContain("function ModeButton");
        expect(source).not.toContain("aria-pressed={active}");
    });
});
