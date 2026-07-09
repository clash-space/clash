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
      } else if (/\.(ts|tsx|md|mjs|json)$/.test(entry.name)) {
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

  it("keeps broad product database file names out of local-first source, docs, and skills", () => {
    const forbiddenProductDatabaseSpellings = [
      String.fromCharCode(100, 98, 46, 106, 115, 111, 110),
      String.fromCharCode(100, 98, 92, 46, 106, 115, 111, 110),
    ];
    const scannedFiles = [
      ...sourceFilesUnder("apps/local-api/src"),
      ...sourceFilesUnder("packages/cli/src"),
      ...sourceFilesUnder("packages/shared-runtime/src"),
      ...sourceFilesUnder("packages/shared-types/src"),
      ...sourceFilesUnder("packages/web-ui/src"),
      ...sourceFilesUnder("skills"),
      ...sourceFilesUnder("docs"),
    ];

    const matches = scannedFiles
      .map((file) => ({ file, content: readFileSync(file, "utf8") }))
      .flatMap(({ file, content }) =>
        forbiddenProductDatabaseSpellings
          .filter((name) => content.includes(name))
          .map(() => `${file.slice(repoRoot.length + 1)} contains a forbidden product database spelling`),
      );

    expect(matches).toEqual([]);
  });

  it("does not keep obsolete broad-product compatibility paths", () => {
    const db = String.fromCharCode(100, 98);
    const json = String.fromCharCode(106, 115, 111, 110);
    const forbiddenFragments = [
      ["legacy", "Product", "Json", "Database"].join(""),
      ["legacy", "-", "product", "-", "json", "-", "database"].join(""),
      ["legacy product", " JSON database"].join(""),
      ["product", " JSON database"].join(""),
    ];
    const forbiddenJoinPattern = new RegExp(
      String.raw`\[\s*["']${db}["']\s*,\s*["']${json}["']\s*\]\.join\(\s*["']\.["']\s*\)`,
    );
    const scannedFiles = [
      ...sourceFilesUnder("apps/local-api/src"),
      ...sourceFilesUnder("apps/desktop/e2e"),
      ...sourceFilesUnder("packages/cli/src"),
      ...sourceFilesUnder("packages/shared-runtime/src"),
      ...sourceFilesUnder("packages/shared-types/src"),
      ...sourceFilesUnder("packages/web-ui/src"),
      ...sourceFilesUnder("skills"),
      ...sourceFilesUnder("docs"),
    ];

    const matches = scannedFiles.flatMap((file) => {
      const content = readFileSync(file, "utf8");
      const relativePath = file.slice(repoRoot.length + 1);
      const fragmentMatches = forbiddenFragments
        .filter((fragment) => content.includes(fragment))
        .map((fragment) => `${relativePath} contains ${fragment}`);
      return forbiddenJoinPattern.test(content)
        ? [...fragmentMatches, `${relativePath} constructs a forbidden local-first product filename`]
        : fragmentMatches;
    });

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
