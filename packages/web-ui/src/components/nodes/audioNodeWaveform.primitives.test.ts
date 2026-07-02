import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

describe("AudioNode waveform seek primitive", () => {
    it("uses the shared Radix-backed slider primitive instead of hand-rolled click coordinate seeking", () => {
        const source = readNodeSource("AudioNode.tsx");

        expect(source).toContain("../ui/slider");
        expect(source).toContain("Slider");
        expect(source).toContain("SliderTrack");
        expect(source).toContain("SliderThumb");
        expect(source).not.toContain("waveformRef");
        expect(source).not.toContain("handleWaveformClick");
        expect(source).not.toContain("getBoundingClientRect");
    });
});
