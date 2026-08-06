import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type ClashRuntimeProfile = "dev" | "prod";

export function resolveClashProfile(
  env: Record<string, string | undefined> = process.env,
): ClashRuntimeProfile {
  const profile = env.CLASH_PROFILE?.trim() || "prod";
  if (profile === "dev" || profile === "prod") return profile;
  throw new Error("CLASH_PROFILE must be dev or prod");
}

/** Canonical self-hosted Clash storage root: $CLASH_HOME or ~/.clash. */
export function defaultClashHome(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.CLASH_HOME?.trim();
  if (explicit) return resolve(explicit);
  const root = join(homedir(), ".clash");
  return resolveClashProfile(env) === "dev" ? join(root, "profiles", "dev") : root;
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
