import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function findRepoRoot(startDirectory: string): string {
  let directory = resolve(startDirectory);
  while (directory !== dirname(directory)) {
    if (statSync(join(directory, "pnpm-workspace.yaml"), { throwIfNoEntry: false })?.isFile()) {
      return directory;
    }
    directory = dirname(directory);
  }
  throw new Error("Could not find repository root");
}

const repoRoot = findRepoRoot(process.cwd());

function readScript(name: string): string {
  return readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function sourceFilesUnder(path: string): string[] {
  const root = join(repoRoot, path);
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "release"
      ) {
        continue;
      }
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (/\.(ts|tsx|md)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files;
}

describe("local data dir contract", () => {
  it("selects active local-api data stores by SQLite presence in conformance scripts", () => {
    const providerConformance = readScript("provider-conformance.ts");
    const googleAgentPlatform = readScript("google-agent-platform-conformance.ts");

    expect(providerConformance).toContain('existsSync(join(desktop, "local.sqlite"))');
    expect(googleAgentPlatform).toContain('existsSync(join(desktop, "local.sqlite"))');
    expect(providerConformance).not.toContain("|| existsSync(join(desktop,");
    expect(googleAgentPlatform).not.toContain("|| existsSync(join(desktop,");
  });

  it("keeps the legacy JSON database file name out of local-first source and docs", () => {
    const legacyName = "db" + ".json";
    const scannedFiles = [
      ...sourceFilesUnder("apps/local-api/src"),
      ...sourceFilesUnder("packages/cli/src"),
      ...sourceFilesUnder("packages/shared-runtime/src"),
      ...sourceFilesUnder("packages/shared-types/src"),
      ...sourceFilesUnder("packages/web-ui/src"),
      ...sourceFilesUnder("docs"),
    ];

    const matches = scannedFiles
      .map((file) => ({ file, content: readFileSync(file, "utf8") }))
      .filter(({ content }) => content.includes(legacyName))
      .map(({ file }) => file.slice(repoRoot.length + 1));

    expect(matches).toEqual([]);
  });

  it("documents Settings sync readiness switches as the cloud admission control", () => {
    const inventory = readRepoFile("docs/agent-first-local-v1-api-surface-inventory.md");
    const boundary = readRepoFile("docs/agent-first-local-v1-remote-compatibility-boundary.md");
    const traceability = readRepoFile("docs/agent-first-local-v1-traceability-matrix.md");

    for (const doc of [inventory, boundary, traceability]) {
      expect(doc).toContain("SettingsClient");
      expect(doc).toContain("Cloud mirror readiness");
      expect(doc).toContain("Canvas mirror ready");
      expect(doc).toContain("Asset metadata mirror ready");
      expect(doc).toContain("Revision content mirror ready");
    }
  });
});
