import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const COLOCATED_TEST_SOURCE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Fails the build when a workspace dependency's emitted output is older than production source.
 *
 * Colocated test/spec files are deliberately excluded from the source timestamp: package builds do
 * not emit them, so editing a test cannot make an otherwise current `dist` stale.
 */
export function assertDependencyDistIsFresh(
  packageDirs: readonly string[],
): void {
  const stale: string[] = [];
  for (const dir of packageDirs) {
    const srcDir = join(dir, "src");
    const distDir = join(dir, "dist");
    if (!existsSync(srcDir) || !existsSync(distDir)) continue;
    const newestSource = newestMtime(srcDir, true);
    const newestBuild = newestMtime(distDir, false);
    if (
      newestSource !== undefined &&
      newestBuild !== undefined &&
      newestSource > newestBuild
    ) {
      stale.push(relative(process.cwd(), dir));
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Refusing to bundle the host: dist is older than src in ${stale.join(", ")}. ` +
        "Run `pnpm build:package clash` from the repository root so Turbo rebuilds the dependency graph.",
    );
  }
}

function newestMtime(
  dir: string,
  excludeColocatedTestSources: boolean,
): number | undefined {
  let newest: number | undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (excludeColocatedTestSources && COLOCATED_TEST_SOURCE.test(entry.name))
      continue;
    const full = join(dir, entry.name);
    const stamp = entry.isDirectory()
      ? newestMtime(full, excludeColocatedTestSources)
      : statSync(full).mtimeMs;
    if (stamp !== undefined && (newest === undefined || stamp > newest))
      newest = stamp;
  }
  return newest;
}
