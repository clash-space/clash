import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceMatches } from "../../test-support/source-match";

const css = readFileSync(
  join(process.cwd(), "apps/web/app/globals.css"),
  "utf8",
);

describe("asset generation preview motion", () => {
  it("stops generated-card motion when reduced motion is requested", () => {
    expect(
      sourceMatches(
        css,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{.{0,1200}\.clash-asset-generation-preview__card.{0,500}animation:\s*none\s*!important/,
      ),
    ).toBe(true);
  });
});
