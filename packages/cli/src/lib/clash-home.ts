import { defaultClashHome } from "@clash/shared-runtime/local-paths";

export function resolveClashRoot(env: Record<string, string | undefined> = process.env): string {
  return defaultClashHome(env);
}
