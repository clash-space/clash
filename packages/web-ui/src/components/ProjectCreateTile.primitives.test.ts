import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceContains, sourceMatches } from "../test-support/source-match";

describe("ProjectCreateTile primitive usage", () => {
  const readComponent = (name: string) =>
    readFileSync(
      join(process.cwd(), `packages/web-ui/src/components/${name}`),
      "utf8",
    );

  it("keeps the new-project tile in one shared component", () => {
    const createTile = readComponent("ProjectCreateTile.tsx");
    const recentProjects = readComponent("RecentProjects.tsx");
    const projectsClient = readComponent("ProjectsClient.tsx");

    expect(sourceContains(createTile, "./ui/button")).toBe(true);
    expect(sourceMatches(createTile, /<Button\b/)).toBe(true);
    expect(sourceContains(createTile, "clash-project-create-tile")).toBe(true);
    expect(sourceMatches(createTile, /<button[\s\S]*clash-project-create-tile/)).toBe(false);
    expect(sourceContains(recentProjects, "./ProjectCreateTile")).toBe(true);
    expect(sourceContains(projectsClient, "./ProjectCreateTile")).toBe(true);
    expect(sourceMatches(recentProjects, /<button[\s\S]*clash-project-create-tile/)).toBe(false);
    expect(sourceMatches(projectsClient, /<button[\s\S]*clash-project-create-tile/)).toBe(false);
  });

  it("uses semantic form tokens instead of legacy palette utilities", () => {
    const createTile = readComponent("ProjectCreateTile.tsx");

    expect(sourceContains(createTile, 'controlSize="lg"')).toBe(true);
    expect(sourceContains(createTile, "text-content-secondary")).toBe(true);
    expect(sourceMatches(createTile, /<InlineAlert\s+tone="error"/)).toBe(true);
    expect(sourceMatches(createTile, /text-(?:stone|slate|red)-/)).toBe(false);
  });
});
