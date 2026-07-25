import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () =>
    readFileSync(
        join(process.cwd(), "packages/web-ui/src/components/nodes/DraftPlaceholder.tsx"),
        "utf8",
    );

describe("DraftPlaceholder action primitives", () => {
    it("uses the shared Button primitive for the build affordance", () => {
        const draftPlaceholder = source();

        expect(draftPlaceholder).toContain("../ui/button");
        expect(draftPlaceholder).toMatch(/<Button[\s\S]*onClick=\{openDialog\}[\s\S]*Build/);
        expect(draftPlaceholder).not.toContain("<motion.button");
        expect(draftPlaceholder).not.toContain("framer-motion");
    });

    it("uses the compact draft layout inside the short audio node", () => {
        const audioNode = readFileSync(
            join(process.cwd(), "packages/web-ui/src/components/nodes/AudioNode.tsx"),
            "utf8",
        );

        expect(audioNode).toMatch(/<DraftPlaceholder[\s\S]*modality="audio"[\s\S]*compact/);
    });
});
