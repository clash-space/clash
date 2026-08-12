#!/usr/bin/env bash
# Thin wrapper over what the repo already has: pnpm workspaces + turbo + .nvmrc.
#
# It exists for exactly two reasons, not to replace them:
#   1. `nvm use` per shell. Every tool call is a fresh shell, and without this the wrong Node
#      silently picks up a different sqlite and a different resolver.
#   2. `probe`, which runs the host's plugin layer from source. There is no package script for it
#      because it is a diagnostic, not part of any package's build.
#
# For everything else use the root scripts directly: `pnpm build`, `pnpm test`,
# `pnpm --filter @clash-plugin/google test`.
set -uo pipefail
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; nvm use >/dev/null 2>&1

case "${1:-}" in
build) pnpm build "${@:2}" ;;
test)  pnpm test "${@:2}" ;;
tsc)   pnpm -r exec tsc --noEmit ;;

# The host's plugin layer, from source. No dist, no HTTP, no background daemon: resolving through
# dist is what let a stale bundle answer a test about new code for two rounds.
probe)
  cat > apps/local-api/src/_probe.ts <<'PROBE'
import { join } from "node:path";
import { BUNDLED_PLUGINS, ensureBundledPlugin } from "./bundled-plugins.js";

const actionsRoot = join(process.env.HOME!, ".clash", "actions");
for (const plugin of BUNDLED_PLUGINS) {
  try {
    const r = await ensureBundledPlugin({ id: plugin.id, actionsRoot });
    console.log(`  ${plugin.id.padEnd(24)} ${r.installed ? "seeded" : "present"}`);
  } catch (error) {
    console.log(`  ${plugin.id.padEnd(24)} failed: ${(error as Error).message.slice(0, 100)}`);
  }
}

const { ActionsHost } = await import("@clash/cli/actions-host");
const host = new ActionsHost({
  actionsRoot, serverUrl: "http://127.0.0.1:0", apiKey: "",
  runtimeId: "probe", executablePluginsOnly: true,
} as never);
await host.start?.();
await new Promise((resolve) => setTimeout(resolve, 2500));
console.log("\nProviders:");
for (const p of host.listProviders?.() ?? []) {
  const auth = (p.document?.spec as { auth?: { methods?: { id: string }[] } })?.auth;
  const methods = (auth?.methods ?? []).map((m) => m.id);
  console.log(`  ${p.pluginId.padEnd(20)} -> ${String((p.document?.spec as { id?: string })?.id).padEnd(10)} ${JSON.stringify(methods)}`);
}
// process.exit rather than host.stop(): ActionsHost has no stop(), so awaiting a method that does
// not exist left the file watcher holding the event loop and the probe never returned.
process.exit(0);
PROBE
  (cd apps/local-api && pnpm exec tsx src/_probe.ts; rm -f src/_probe.ts)
  ;;

*) echo "usage: ./dev.sh {build|test|tsc|probe}   (or just: pnpm build | pnpm test)"; exit 1;;
esac
