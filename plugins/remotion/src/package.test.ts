import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

it("copies a portable browser bundle as a declared plugin resource", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "remotion-source-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "remotion-target-"));
  await mkdir(join(sourceRoot, "public"), { recursive: true });
  await writeFile(
    join(sourceRoot, "index.html"),
    '<script>window.remotion_cwd = "/Users/example/repo";</script>',
  );
  await writeFile(
    join(sourceRoot, "bundle.js"),
    'console.log("bundle");\n//# sourceMappingURL=bundle.js.map\n',
  );
  await writeFile(join(sourceRoot, "bundle.js.map"), "{}\n");
  await writeFile(join(sourceRoot, "public", "tone.wav"), "audio");

  const module = await import("../scripts/copy-browser-bundle.js").catch(
    () => undefined,
  );
  expect(module?.copyBrowserBundle).toBeTypeOf("function");
  if (!module?.copyBrowserBundle) return;
  await module.copyBrowserBundle({ sourceRoot, targetRoot });

  expect((await readdir(targetRoot)).sort()).toEqual([
    "bundle.js",
    "index.html",
    "public",
  ]);
  expect(await readFile(join(targetRoot, "index.html"), "utf8")).toContain(
    'window.remotion_cwd = ".";',
  );
  const copiedJavaScript = await readFile(
    join(targetRoot, "bundle.js"),
    "utf8",
  );
  expect(copiedJavaScript).toContain('console.log("bundle")');
  expect(copiedJavaScript).not.toMatch(/sourceMappingURL/);
  expect(await readFile(join(targetRoot, "public", "tone.wav"), "utf8")).toBe(
    "audio",
  );
});
