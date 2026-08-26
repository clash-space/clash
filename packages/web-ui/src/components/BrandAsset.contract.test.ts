import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceMatches } from "../test-support/source-match";

const productIdentityConsumers = [
  "apps/web/app/routes/login.tsx",
  "packages/web-ui/src/components/TopNavigation.tsx",
  "packages/web-ui/src/components/ProjectsClient.tsx",
  "packages/web-ui/src/components/landing/ClashWordmark.tsx",
] as const;

describe("brand identity asset contract", () => {
  it.each(productIdentityConsumers)(
    "%s consumes product identity through BrandAsset",
    (relativePath) => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");

      expect(sourceMatches(source, /<BrandAsset\b/)).toBe(true);
      expect(sourceMatches(source, /src=["']\/brand\/logo-mark/)).toBe(false);
      expect(sourceMatches(source, /src=["']\/icon-192\.png/)).toBe(false);
    },
  );

  it("resolves data-driven Clash provider logos from the same registry", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/SettingsClient.tsx"),
      "utf8",
    );

    expect(sourceMatches(source, /CLASH_BRAND_ASSETS\.mark\.src/)).toBe(true);
    expect(sourceMatches(source, /src:\s*["']\/brand\/logo-mark\.svg/)).toBe(
      false,
    );
  });
});
