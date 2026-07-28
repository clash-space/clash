import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** Canonical self-hosted Clash storage root: $CLASH_HOME or ~/.clash. */
export function defaultClashHome(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.CLASH_HOME?.trim();
  return explicit ? resolve(explicit) : join(homedir(), ".clash");
}

/** Local API state always lives under the canonical Clash home. */
export function defaultLocalApiDataDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.CLASH_LOCAL_DATA_DIR?.trim();
  return explicit ? resolve(explicit) : join(defaultClashHome(env), "local-api");
}

export function clashHomeForLocalDataDir(
  localDataDir: string,
  explicitClashHome?: string,
): string {
  if (explicitClashHome?.trim()) return resolve(explicitClashHome);
  const resolved = resolve(localDataDir);
  return basename(resolved) === "local-api" ? dirname(resolved) : resolved;
}
