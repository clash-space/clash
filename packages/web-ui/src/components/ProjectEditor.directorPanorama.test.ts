import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sourceContains, sourceMatches } from "../test-support/source-match";
const source = readFileSync(
  new URL("./ProjectEditor.tsx", import.meta.url),
  "utf8",
);

describe("ProjectEditor director panorama media URLs", () => {
  it("keeps the Host-projected Project Asset URL instead of reconstructing storage URLs", () => {
    expect(source).not.toContain("resolveAssetMediaUrl");
    expect(sourceContains(source, "url: panoramaAsset.url")).toBe(true);
  });

  it("uses a 2:1 reference image and rejects only mismatched aspect ratios", () => {
    expect(source).toContain("renderDirectorPanoramaReference");
    expect(source).toContain("createDirectorPanoramaReferenceFile");
    expect(sourceContains(source, 
      'const directorPanoramaModel = MODEL_CARDS.find((card) => card.id === "gpt-image-2")',
    ), `mechanism missing`).toBe(true);
    expect(source).toContain(
      'const modelId = directorPanoramaModel?.id ?? "gpt-image-2";',
    );
    expect(source).toContain('aspect_ratio: "2:1"');
    expect(source).toContain("width: 2048");
    expect(source).toContain("height: 1024");
    expect(source).toContain('quality: "high"');
    expect(source).toContain('output_format: "webp"');
    expect(source).toContain("require_real_provider: true");
    expect(source).toContain("sourceWidth !== sourceHeight * 2");
    expect(source).not.toContain("strictSize: true");
    expect(source).not.toContain('aspect_ratio: "21:9"');
    expect(source).not.toContain('aspectRatio: "21:9"');
  });

  it("persists the active spherical or finite calibration on every AI panorama", () => {
    expect(source).toContain(
      "createDirectorPanoramaReferenceFile(input.calibration)",
    );
    expect(source).toContain(
      "panoramaCalibration: input.calibration",
    );
    expect(source).toContain(
      "calibration: input.calibration",
    );
  });
});
