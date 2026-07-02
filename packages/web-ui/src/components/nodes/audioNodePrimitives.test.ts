import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes/AudioNode.tsx"), "utf8");

describe("AudioNode action primitives", () => {
    it("uses shared IconButton primitives for modal controls", () => {
        const audioNode = source();

        expect(audioNode).toContain("../ui/icon-button");
        expect(audioNode).toMatch(/<IconButton[\s\S]*label="Close audio player"/);
        expect(audioNode).toMatch(/<IconButton[\s\S]*label=\{`Skip back \$\{SKIP_SECONDS\}s`\}/);
        expect(audioNode).toMatch(/<IconButton[\s\S]*label=\{isPlaying \? "Pause" : "Play"\}/);
        expect(audioNode).toMatch(/<IconButton[\s\S]*label=\{`Skip forward \$\{SKIP_SECONDS\}s`\}/);
        expect(audioNode).not.toMatch(/<button[\s\S]*setShowModal\(false\)/);
        expect(audioNode).not.toMatch(/<button[\s\S]*handleSkipBack/);
        expect(audioNode).not.toMatch(/<button[\s\S]*togglePlay/);
        expect(audioNode).not.toMatch(/<button[\s\S]*handleSkipForward/);
    });
});
