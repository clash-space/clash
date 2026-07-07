import { homedir } from "node:os";
import { resolve, join } from "node:path";

export function resolveClashRoot(env: Record<string, string | undefined> = process.env): string {
  const override = env.CLASH_HOME?.trim();
  return override ? resolve(override) : join(homedir(), ".clash");
}
