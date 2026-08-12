import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("canvas add delegates reference resolution to the authoritative host", () => {
  const source = readFileSync(
    join(__dirname, "canvas.ts"),
    "utf8",
  );
  const hostSource = readFileSync(
    join(__dirname, "../../../../apps/local-api/src/project-command-host.ts"),
    "utf8",
  );

  it("does not list or resolve references in the CLI", () => {
    expect(source).not.toMatch(/function resolveReferences|action: "list"[\s\S]*nodeIdByAssetId/);
    expect(source).toMatch(/action: "add"[\s\S]*refs: options\.ref/);
  });

  it("rejects unresolved references before the host creates a node", () => {
    expect(hostSource).toMatch(/code: "UNRESOLVED_REFERENCE"/);
    expect(hostSource.indexOf('code: "UNRESOLVED_REFERENCE"')).toBeLessThan(
      hostSource.indexOf("client.createNode("),
    );
  });
});
