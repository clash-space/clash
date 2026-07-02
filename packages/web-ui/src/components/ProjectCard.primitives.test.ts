import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ProjectCard primitive usage", () => {
  const source = () =>
    readFileSync(join(process.cwd(), "packages/web-ui/src/components/ProjectCard.tsx"), "utf8");

  it("uses the shared IconButton primitive for the destructive project action", () => {
    const projectCardSource = source();

    expect(projectCardSource).toContain("./ui/icon-button");
    expect(projectCardSource).toContain("<IconButton");
    expect(projectCardSource).not.toMatch(/<button[\s\S]*clash-project-card-delete/);
    expect(projectCardSource).not.toContain("stopPropagation()");
  });
});
