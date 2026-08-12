import { createHash } from "node:crypto";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type CachedBundle = {
  fingerprint: string;
  path: string;
};

export interface DevelopmentBrowserAssets {
  readonly directorBundleDir: string;
  resolveRemotionServeUrl(): Promise<string>;
  prepareDirectorBundle(): Promise<void>;
}

const REMOTION_SOURCE_PACKAGES = [
  "remotion-components",
  "remotion-core",
  "remotion-effects",
  "shared-layout",
  "shared-types",
] as const;

const DIRECTOR_SOURCE_PACKAGES = [
  "director-core",
  "director-ui",
  "remotion-components",
  "remotion-core",
  "remotion-effects",
  "remotion-ui",
  "shared-layout",
  "shared-types",
] as const;

async function sourceFingerprint(paths: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (path: string): Promise<void> => {
    const metadata = await stat(path);
    hash.update(path);
    hash.update(String(metadata.size));
    hash.update(String(metadata.mtimeMs));
    if (!metadata.isDirectory()) return;
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await visit(join(path, entry.name));
    }
  };
  for (const path of paths) await visit(path);
  return hash.digest("hex");
}

function packageInputs(
  repoRoot: string,
  packageNames: readonly string[],
): string[] {
  return packageNames.flatMap((packageName) => [
    join(repoRoot, "packages", packageName, "package.json"),
    join(repoRoot, "packages", packageName, "src"),
  ]);
}

/**
 * Builds browser-only assets from workspace source on demand.
 *
 * The local daemon is long-lived, so relying on the checked-in production
 * bundles makes UI edits appear stale even though the TypeScript host itself
 * is running through tsx. A fingerprint is checked before every render and
 * only the affected browser bundle is rebuilt.
 */
export function createDevelopmentBrowserAssets(options: {
  repoRoot: string;
  cacheRoot?: string;
}): DevelopmentBrowserAssets {
  const repoRoot = resolve(options.repoRoot);
  const cacheKey = createHash("sha256")
    .update(repoRoot)
    .digest("hex")
    .slice(0, 12);
  const cacheRoot = resolve(
    options.cacheRoot ?? join(tmpdir(), `clash-browser-assets-${cacheKey}`),
  );
  const directorBundleDir = join(cacheRoot, "director-bundle");
  const directorAssetsDir = join(cacheRoot, "assets");
  const remotionInputs = packageInputs(repoRoot, REMOTION_SOURCE_PACKAGES);
  const directorInputs = [
    ...packageInputs(repoRoot, DIRECTOR_SOURCE_PACKAGES),
    join(repoRoot, "packages", "director-ui", "assets"),
  ];

  let remotionBundle: CachedBundle | undefined;
  let remotionBuild: Promise<CachedBundle> | undefined;
  let directorFingerprint: string | undefined;
  let directorBuild: Promise<void> | undefined;

  const resolveRemotionServeUrl = async (): Promise<string> => {
    const fingerprint = await sourceFingerprint(remotionInputs);
    if (remotionBundle?.fingerprint === fingerprint) return remotionBundle.path;
    if (remotionBuild) {
      const built = await remotionBuild;
      return built.fingerprint === fingerprint
        ? built.path
        : resolveRemotionServeUrl();
    }
    const pending = (async (): Promise<CachedBundle> => {
      console.error(
        remotionBundle
          ? "[clash] Remotion source changed; rebuilding the development bundle"
          : "[clash] Building the Remotion development bundle from source",
      );
      const { bundle } = await import("@remotion/bundler");
      const path = await bundle({
        entryPoint: join(
          repoRoot,
          "packages",
          "remotion-components",
          "src",
          "Root.tsx",
        ),
      });
      const previousPath = remotionBundle?.path;
      if (previousPath && previousPath !== path) {
        await rm(previousPath, { recursive: true, force: true });
      }
      return { fingerprint, path };
    })();
    remotionBuild = pending;
    try {
      remotionBundle = await pending;
      return remotionBundle.path;
    } finally {
      if (remotionBuild === pending) remotionBuild = undefined;
    }
  };

  const prepareDirectorBundle = async (): Promise<void> => {
    const fingerprint = await sourceFingerprint(directorInputs);
    if (directorFingerprint === fingerprint) return;
    if (directorBuild) {
      await directorBuild;
      if (directorFingerprint !== fingerprint) await prepareDirectorBundle();
      return;
    }
    const pending = (async (): Promise<void> => {
      console.error(
        directorFingerprint
          ? "[clash] Director source changed; rebuilding the development bundle"
          : "[clash] Building the Director development bundle from source",
      );
      const { build } = await import("esbuild");
      await rm(directorBundleDir, { recursive: true, force: true });
      await mkdir(directorBundleDir, { recursive: true });
      await build({
        absWorkingDir: repoRoot,
        entryPoints: [
          join(repoRoot, "packages", "director-ui", "src", "headless-entry.tsx"),
        ],
        outfile: join(directorBundleDir, "index.js"),
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "chrome120",
        sourcemap: "inline",
      });
      await writeFile(
        join(directorBundleDir, "index.html"),
        [
          "<!doctype html>",
          '<html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#171816}</style></head>',
          '<body><div id="root"></div><script type="module" src="./index.js"></script></body></html>',
          "",
        ].join("\n"),
        "utf8",
      );
      await rm(directorAssetsDir, { recursive: true, force: true });
      await cp(
        join(repoRoot, "packages", "director-ui", "assets"),
        directorAssetsDir,
        { recursive: true },
      );
      directorFingerprint = fingerprint;
    })();
    directorBuild = pending;
    try {
      await pending;
    } finally {
      if (directorBuild === pending) directorBuild = undefined;
    }
  };

  return {
    directorBundleDir,
    resolveRemotionServeUrl,
    prepareDirectorBundle,
  };
}
