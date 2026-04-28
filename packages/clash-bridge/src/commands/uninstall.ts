/**
 * `clash-bridge uninstall` — tear down launchd / systemd unit, remove
 * credentials, attempt server-side revoke. Best-effort: each step
 * continues on failure so a partially-broken install can still be cleaned.
 *
 * Server-side revoke is best-effort because:
 *   - The user may have already deleted the runtime via web UI (DELETE
 *     /api/v1/runtimes/:id), in which case our token is gone too and the
 *     call returns 401.
 *   - The user may not have network when uninstalling (laptop in airplane
 *     mode).
 *
 * Either way, the local side is what matters: stop the service, delete the
 * creds. Stale rows on server eventually GC themselves (sweeper marks
 * runtimes offline after no heartbeat; user can delete manually).
 */

import { uninstall as uninstallLaunchd } from "../lib/launchd.js";
import { readCreds, deleteCreds } from "../lib/config.js";
import { paths, currentPlatform } from "../lib/platform.js";

export async function runUninstall(): Promise<void> {
  process.stderr.write(`→ clash-bridge uninstall\n`);

  // Step 1: stop the service first, so it isn't in the middle of writing
  // to creds file when we delete it.
  if (currentPlatform() === "darwin") {
    try {
      const r = await uninstallLaunchd();
      process.stderr.write(
        r.removed
          ? `✓ launchd plist removed (${paths().serviceFile})\n`
          : `· launchd plist not present\n`,
      );
    } catch (e) {
      process.stderr.write(
        `! launchd uninstall failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  // Step 2: best-effort server-side revoke.
  const creds = await readCreds();
  if (creds) {
    const url = `${creds.serverUrl.replace(/\/$/, "")}/api/v1/runtimes/${creds.runtimeId}`;
    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { "x-runtime-token": creds.token },
        // Server's DELETE /api/v1/runtimes/:id requires user auth via session
        // cookie / API token — our runtime token isn't accepted there. We
        // call it anyway so logs show an attempt; expected outcome is 401
        // when daemon-only credentials are present. Browser-side uninstall
        // (Settings → Remove machine) is the supported revoke path.
      });
      process.stderr.write(
        `· server revoke: HTTP ${res.status} (browser-side revoke is the supported path)\n`,
      );
    } catch (e) {
      process.stderr.write(
        `· server revoke skipped: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  // Step 3: delete creds.
  try {
    await deleteCreds();
    process.stderr.write(`✓ credentials removed (${paths().credsFile})\n`);
  } catch (e) {
    process.stderr.write(
      `! creds removal failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }

  process.stderr.write(`Done.\n`);
}
