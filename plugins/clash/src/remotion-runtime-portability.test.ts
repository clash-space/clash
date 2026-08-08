import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bundleRoot = fileURLToPath(
  new URL("../runtime/remotion-bundle/", import.meta.url),
);

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
};

test("the packaged Remotion bundle is portable and ships without source maps", async () => {
  const files = await listFiles(bundleRoot);
  const sourceMaps = files.filter((path) => extname(path) === ".map");

  assert.deepEqual(sourceMaps, [], "published runtime must not include source maps");

  const textFiles = files.filter((path) =>
    [".css", ".html", ".js", ".json", ".txt"].includes(extname(path)),
  );
  for (const path of textFiles) {
    const contents = await readFile(path, "utf8");
    assert.doesNotMatch(
      contents,
      /\/(?:Users|private)\//,
      `${path} contains a host-specific absolute path`,
    );
    assert.doesNotMatch(
      contents,
      /^\s*\/\/[#@]\s*sourceMappingURL=.*\.map\s*$/gm,
      `${path} references a source map that must not ship`,
    );
  }

  const indexHtml = await readFile(join(bundleRoot, "index.html"), "utf8");
  assert.match(indexHtml, /window\.remotion_cwd = "\.";/);
});
