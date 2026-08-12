import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  assertDraftOutsideManagedStorage,
  managedStorageDraftHint,
} from "./plugin-draft-location";

/**
 * `$CLASH_HOME` is product-internal storage. `clash plugin activate` copies a
 * validated draft into `$CLASH_HOME/actions/<id>/` and owns that copy from then on:
 * it is content-hashed, recorded in `actions.activations/`, and rolled back through
 * `actions/.rollback/`.
 *
 * A draft is the opposite -- freely editable, unattested source. Putting one inside
 * `$CLASH_HOME` puts an unmanaged tree in the middle of managed state, and it
 * invents a third meaning for "drafts", which everywhere else in the product means
 * `workspaceRoot/drafts`. This is not hypothetical: a real installation ended up
 * with `$CLASH_HOME/drafts/hilo-hub-media` sitting beside the activated copy.
 */
const created: string[] = [];

after(async () => {
  await Promise.all(created.map((path) => rm(path, { recursive: true, force: true })));
});

async function tempClashHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "clash-home-"));
  created.push(root);
  await mkdir(join(root, "actions"), { recursive: true });
  await writeFile(join(root, "config.yaml"), "version: 1\n", "utf8");
  return root;
}

describe("plugin draft location", () => {
  it("rejects a draft directly inside the managed root", async () => {
    const home = await tempClashHome();
    assert.throws(
      () => assertDraftOutsideManagedStorage(join(home, "drafts", "my-plugin"), { CLASH_HOME: home }),
      /product-internal storage/i,
    );
  });

  it("rejects a draft nested under the activated plugin directory", async () => {
    const home = await tempClashHome();
    assert.throws(
      () => assertDraftOutsideManagedStorage(join(home, "actions", "my-plugin"), { CLASH_HOME: home }),
      /product-internal storage/i,
    );
  });

  it("rejects the managed root itself", async () => {
    const home = await tempClashHome();
    assert.throws(
      () => assertDraftOutsideManagedStorage(home, { CLASH_HOME: home }),
      /product-internal storage/i,
    );
  });

  it("names the offending path and the supported flow", async () => {
    const home = await tempClashHome();
    let message = "";
    try {
      assertDraftOutsideManagedStorage(join(home, "drafts", "my-plugin"), { CLASH_HOME: home });
    } catch (error) {
      message = (error as Error).message;
    }
    assert.match(message, /my-plugin/, "must name the rejected path");
    assert.match(message, /clash plugin activate/, "must point at the command that stores it");
  });

  it("accepts an ordinary working directory", async () => {
    const home = await tempClashHome();
    const workspace = await mkdtemp(join(tmpdir(), "clash-draft-"));
    created.push(workspace);
    assertDraftOutsideManagedStorage(join(workspace, "my-plugin"), { CLASH_HOME: home });
  });

  it("accepts a sibling whose name merely starts with the managed root", async () => {
    // A prefix comparison on strings would reject `<home>-scratch`, which is a
    // different directory entirely.
    const home = await tempClashHome();
    assertDraftOutsideManagedStorage(`${home}-scratch/my-plugin`, { CLASH_HOME: home });
  });

  it("offers a hint that does not leak the internal layout", () => {
    const hint = managedStorageDraftHint();
    assert.match(hint, /clash plugin create/);
    assert.doesNotMatch(hint, /\.rollback|actions\.activations/);
  });
});
