import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

let bundleRoot = "";
let bundledGuidance = "";

async function readMarkdownTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return readMarkdownTree(path);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return [await readFile(path, "utf8")];
  }));
  return contents.flat();
}

beforeAll(async () => {
  bundleRoot = await mkdtemp(join(tmpdir(), "clash-agent-guidance-"));
  const isolatedPackage = join(bundleRoot, "clash-bridge");
  await cp(join(packageRoot, "assets"), join(isolatedPackage, "assets"), { recursive: true });
  await cp(
    join(packageRoot, "scripts", "bundle-agents.mjs"),
    join(isolatedPackage, "scripts", "bundle-agents.mjs"),
  );
  await execFileAsync(process.execPath, [join(isolatedPackage, "scripts", "bundle-agents.mjs")]);
  bundledGuidance = (await readMarkdownTree(join(isolatedPackage, "dist", "agents"))).join("\n");
});

afterAll(async () => {
  if (bundleRoot) await rm(bundleRoot, { recursive: true, force: true });
});

it("bundles public Project Timeline guidance and rejects removed command spellings", () => {
  expect(bundledGuidance).toContain("clash timeline list --json");
  expect(bundledGuidance).toMatch(/clash timeline pull --timeline <[^>]+>/);
  expect(bundledGuidance).toMatch(/clash timeline apply --timeline <[^>]+>/);
  expect(bundledGuidance).toContain("timelines/<id>.timeline.yaml");
  expect(bundledGuidance).toContain("data.timelineId");

  expect(bundledGuidance).not.toMatch(/clash\s+canvas\s+timeline\s+(?:pull|push)\b/i);
  expect(bundledGuidance).not.toMatch(/clash\s+timeline\s+(?:history|content|restore)\b/i);
});
