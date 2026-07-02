import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ProjectCreateTile primitive usage", () => {
  const readComponent = (name: string) =>
    readFileSync(join(process.cwd(), `packages/web-ui/src/components/${name}`), "utf8");

  it("keeps the new-project tile in one shared component", () => {
    const createTile = readComponent("ProjectCreateTile.tsx");
    const recentProjects = readComponent("RecentProjects.tsx");
    const projectsClient = readComponent("ProjectsClient.tsx");

    expect(createTile).toContain("./ui/button");
    expect(createTile).toMatch(/<Button[\s\S]*clash-project-create-tile/);
    expect(createTile).not.toMatch(/<button[\s\S]*clash-project-create-tile/);
    expect(recentProjects).toContain("./ProjectCreateTile");
    expect(projectsClient).toContain("./ProjectCreateTile");
    expect(recentProjects).not.toMatch(/<button[\s\S]*clash-project-create-tile/);
    expect(projectsClient).not.toMatch(/<button[\s\S]*clash-project-create-tile/);
  });
});
