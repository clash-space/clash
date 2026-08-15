import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function copyBrowserBundle(options: {
  sourceRoot: string;
  targetRoot: string;
}): Promise<void> {
  await rm(options.targetRoot, { recursive: true, force: true });
  await cp(options.sourceRoot, options.targetRoot, {
    recursive: true,
    filter: (source) => !source.endsWith(".map"),
  });

  const makePortable = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          await makePortable(path);
          return;
        }
        if (entry.name.endsWith(".js")) {
          const source = await readFile(path, "utf8");
          const portable = source.replace(
            /^\s*\/\/[#@]\s*sourceMappingURL=.*\.map\s*$/gm,
            "",
          );
          if (portable !== source) await writeFile(path, portable, "utf8");
        }
      }),
    );
  };
  await makePortable(options.targetRoot);

  const indexPath = resolve(options.targetRoot, "index.html");
  const index = await readFile(indexPath, "utf8");
  const cwdPattern = /window\.remotion_cwd = [^;]+;/;
  if (!cwdPattern.test(index)) {
    throw new Error("Remotion browser bundle is missing window.remotion_cwd");
  }
  await writeFile(
    indexPath,
    index.replace(cwdPattern, 'window.remotion_cwd = ".";'),
    "utf8",
  );
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
const current = fileURLToPath(import.meta.url);
if (entrypoint === current) {
  const pluginRoot = resolve(dirname(current), "..");
  await copyBrowserBundle({
    sourceRoot: resolve(
      pluginRoot,
      "../../apps/render-server/.remotion-bundle",
    ),
    targetRoot: resolve(pluginRoot, "dist/browser-bundle"),
  });
}
