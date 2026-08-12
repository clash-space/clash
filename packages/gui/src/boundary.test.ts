import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceMatches } from "../test-support/source-match";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const forbidden = [
  /from\s+["'](?:electron|node:|@clash\/local-api)/,
  /\bfetch\s*\(/,
  /\bWebSocket\b/,
  /\bprocess\./,
  /\b(?:localStorage|sessionStorage|indexedDB)\b/,
];

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSources(path);
    if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (entry.name.includes(".test.")) return [];
    return [path];
  });
}

describe("@clash/gui boundary", () => {
  it("keeps runtime components free of platform I/O", () => {
    const violations = runtimeSources(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbidden
        .filter((pattern) => sourceMatches(source, pattern))
        .map((pattern) => `${path.slice(sourceRoot.length)}: ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });
});
