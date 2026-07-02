import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readNodeSource = (file: string) =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/nodes", file), "utf8");

describe("VideoNode DOM access", () => {
    it("refreshes thumbnails through the rendered video ref instead of a document query", () => {
        const source = readNodeSource("VideoNode.tsx");

        expect(source).toContain("const videoRef = useRef<HTMLVideoElement | null>(null)");
        expect(source).toContain("const video = videoRef.current");
        expect(source).toContain("captureThumbnail(video, videoUrlRef.current, { overwrite })");
        expect(source).toContain("captureThumbnailAfterFrame(video, true)");
        expect(source).not.toContain("document.querySelector(`video");
    });
});
