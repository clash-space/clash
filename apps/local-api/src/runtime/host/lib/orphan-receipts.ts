import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Drop activation receipts whose plugin is no longer installed.
 *
 * Receipts are named for the plugin id and live in a sibling directory of the actions root, so a
 * plugin that is renamed or removed leaves its receipt behind. Two were found on a development
 * machine: `clash-first-party-media.json`, for a directory deleted when the plugin became
 * `clash.media`, and `hilo-hub-media.json`, for one renamed to `hrhrng.hub`.
 *
 * A stale receipt is not inert. It attests a contentHash for an id, so anything later installed
 * under that id inherits an attestation nobody issued for it: the receipt claims the bytes were
 * checked when they were checked for something else. Pruning is therefore an integrity concern, not
 * tidiness.
 *
 * Only the direction that is safe to automate is automated. A receipt with no plugin is removed; a
 * plugin with no receipt is left alone and refuses to load, because the fix there is to reactivate
 * and attest it, which is a decision the user makes rather than one recovered by deleting a file.
 *
 * @returns the plugin ids whose receipts were removed, so the caller can report them.
 */
export async function pruneOrphanActivationReceipts(actionsRoot: string): Promise<string[]> {
  const receiptsDir = `${actionsRoot}.activations`;

  let entries: string[];
  try {
    entries = await readdir(receiptsDir);
  } catch (error) {
    // A machine that has never activated anything has no such directory. Throwing would make first
    // start fail for a condition that is simply the normal beginning.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const pluginId = entry.slice(0, -".json".length);

    // The manifest rather than the directory: an empty directory left by an interrupted install is
    // not a plugin, and treating it as one keeps a receipt alive for something that cannot load.
    const installed = await stat(join(actionsRoot, pluginId, "manifest.json"))
      .then(() => true)
      .catch(() => false);
    if (installed) continue;

    await rm(join(receiptsDir, entry), { force: true });
    removed.push(pluginId);
  }
  return removed;
}
