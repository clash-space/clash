import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneOrphanActivationReceipts } from "./orphan-receipts.js";

/**
 * A receipt outlives the plugin it attests.
 *
 * Receipts are named for the plugin id and live beside the actions root, so renaming or removing an
 * installed plugin leaves its receipt behind. The machine had two: `clash-first-party-media.json`
 * for a directory deleted when the plugin became `clash.media`, and `hilo-hub-media.json` for one
 * renamed to `hrhrng.hub`.
 *
 * The stale receipt is not inert. It attests a contentHash for an id, so an unrelated plugin later
 * installed under that id inherits an attestation nobody issued for it -- the receipt says the
 * bytes were checked when they were checked for something else entirely.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "actions-"));
  const actionsRoot = join(root, "actions");
  const receiptsDir = `${actionsRoot}.activations`;
  mkdirSync(actionsRoot, { recursive: true });
  mkdirSync(receiptsDir, { recursive: true });

  const install = (id: string) => {
    mkdirSync(join(actionsRoot, id), { recursive: true });
    writeFileSync(join(actionsRoot, id, "manifest.json"), JSON.stringify({ id }));
  };
  const receipt = (id: string) =>
    writeFileSync(join(receiptsDir, `${id}.json`), JSON.stringify({
      apiVersion: "clash.plugin.activation/v1",
      pluginId: id, version: "1.0.0",
      schemaHash: `sha256:${"a".repeat(64)}`, contentHash: `sha256:${"b".repeat(64)}`,
      activatedAt: new Date().toISOString(),
    }));

  return { actionsRoot, receiptsDir, install, receipt };
}

describe("orphan activation receipts", () => {
  it("removes a receipt whose plugin is gone", async () => {
    const f = fixture();
    f.install("clash.media");
    f.receipt("clash.media");
    f.receipt("clash-first-party-media");

    const removed = await pruneOrphanActivationReceipts(f.actionsRoot);

    expect(removed).toEqual(["clash-first-party-media"]);
    expect(existsSync(join(f.receiptsDir, "clash.media.json"))).toBe(true);
    expect(existsSync(join(f.receiptsDir, "clash-first-party-media.json"))).toBe(false);
  });

  it("keeps every receipt that still has its plugin", async () => {
    // Deleting a live receipt is worse than keeping a dead one: the plugin stops loading with
    // "no valid activation receipt", and the fix -- reactivating -- looks like an unrelated step.
    const f = fixture();
    for (const id of ["clash.google", "clash.minimax", "hrhrng.hub"]) {
      f.install(id);
      f.receipt(id);
    }

    expect(await pruneOrphanActivationReceipts(f.actionsRoot)).toEqual([]);
    expect(readdirSync(f.receiptsDir)).toHaveLength(3);
  });

  it("ignores files that are not receipts", async () => {
    const f = fixture();
    f.install("clash.google");
    f.receipt("clash.google");
    writeFileSync(join(f.receiptsDir, "notes.txt"), "not a receipt");

    expect(await pruneOrphanActivationReceipts(f.actionsRoot)).toEqual([]);
    expect(existsSync(join(f.receiptsDir, "notes.txt"))).toBe(true);
  });

  it("says nothing was pruned when the directory does not exist yet", async () => {
    // A fresh machine has no receipts directory. Throwing here would make first start fail for a
    // condition that is simply the normal beginning.
    const root = mkdtempSync(join(tmpdir(), "actions-"));
    expect(await pruneOrphanActivationReceipts(join(root, "actions"))).toEqual([]);
  });
});
