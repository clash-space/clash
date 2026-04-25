import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAsset,
  addAssetRef,
  removeAssetRef,
  getAssetByTaskId,
  getAssetById,
  updateAssetCover,
  getProjectOwner,
} from "./assets";

/** Builds a chainable D1 prepare/bind mock and exposes spies on bind+run+first. */
function makeDb() {
  const run = vi.fn().mockResolvedValue({});
  const first = vi.fn().mockResolvedValue(null);
  const bind = vi.fn().mockReturnValue({ run, first });
  const prepare = vi.fn().mockReturnValue({ bind });
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    run,
    first,
  };
}

describe("assets service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAsset", () => {
    it("inserts a row and a corresponding asset_refs entry", async () => {
      const { db, prepare, bind, run } = makeDb();

      const { id } = await createAsset(db, {
        id: "asset-fixed",
        userId: "u-1",
        kind: "image",
        srcR2Key: "uploads/x.png",
        projectId: "p-1",
        metadata: { bytes: 1234 },
      });

      expect(id).toBe("asset-fixed");
      // First prepare = INSERT INTO assets ...; second = INSERT OR IGNORE INTO asset_refs ...
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(prepare.mock.calls[0][0]).toMatch(/INSERT OR REPLACE INTO assets/);
      expect(prepare.mock.calls[1][0]).toMatch(/INSERT OR IGNORE INTO asset_refs/);
      // Asset bind: id, userId, kind, srcR2Key, ...
      expect(bind.mock.calls[0][0]).toBe("asset-fixed");
      expect(bind.mock.calls[0][1]).toBe("u-1");
      expect(bind.mock.calls[0][2]).toBe("image");
      expect(bind.mock.calls[0][3]).toBe("uploads/x.png");
      // asset_refs bind: assetId, projectId, importedAt
      expect(bind.mock.calls[1][0]).toBe("asset-fixed");
      expect(bind.mock.calls[1][1]).toBe("p-1");
      expect(run).toHaveBeenCalledTimes(2);
    });

    it("generates a UUID when no id is provided", async () => {
      const { db, bind } = makeDb();
      vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-2222-3333-4444-555555555555");

      const { id } = await createAsset(db, {
        userId: "u",
        kind: "video",
        srcR2Key: "k",
        projectId: "p",
      });

      expect(id).toBe("11111111-2222-3333-4444-555555555555");
      expect(bind.mock.calls[0][0]).toBe("11111111-2222-3333-4444-555555555555");
    });

    it("serializes metadata JSON and passes NULL for unspecified fields", async () => {
      const { db, bind } = makeDb();
      await createAsset(db, {
        id: "a",
        userId: "u",
        kind: "image",
        srcR2Key: "k",
        projectId: "p",
        coverR2Key: "cover/k.jpg",
        metadata: {
          width: 1920,
          height: 1080,
          durationMs: 5000,
          bytes: 9000,
        },
        sourceModel: "nano-banana-2",
        sourcePrompt: "a cat",
        sourceTaskId: "task-1",
        sources: [
          { assetId: "src-1", role: "reference" },
          { assetId: "src-2", role: "primary" },
        ],
      });

      const args = bind.mock.calls[0];
      // Indices follow the SQL column order in createAsset:
      // id, userId, kind, srcR2Key, coverR2Key, metadata, sourceModel, sourcePrompt, sourceTaskId, sources, createdAt, updatedAt
      expect(args[4]).toBe("cover/k.jpg");        // coverR2Key
      expect(JSON.parse(args[5] as string)).toEqual({
        width: 1920,
        height: 1080,
        durationMs: 5000,
        bytes: 9000,
      });                                          // metadata JSON
      expect(args[6]).toBe("nano-banana-2");      // sourceModel
      expect(args[7]).toBe("a cat");              // sourcePrompt
      expect(args[8]).toBe("task-1");             // sourceTaskId
      expect(JSON.parse(args[9] as string)).toEqual([
        { assetId: "src-1", role: "reference" },
        { assetId: "src-2", role: "primary" },
      ]);                                          // sources JSON
    });

    it("stores NULL for sources when none provided", async () => {
      const { db, bind } = makeDb();
      await createAsset(db, {
        id: "a-no-src",
        userId: "u",
        kind: "image",
        srcR2Key: "k",
        projectId: "p",
      });
      // sources is at index 9 in the bind call
      expect(bind.mock.calls[0][9]).toBeNull();
    });
  });

  describe("addAssetRef / removeAssetRef", () => {
    it("addAssetRef uses INSERT OR IGNORE (idempotent)", async () => {
      const { db, prepare, bind } = makeDb();
      await addAssetRef(db, "asset-1", "proj-2");
      expect(prepare.mock.calls[0][0]).toMatch(/INSERT OR IGNORE INTO asset_refs/);
      expect(bind.mock.calls[0][0]).toBe("asset-1");
      expect(bind.mock.calls[0][1]).toBe("proj-2");
    });

    it("removeAssetRef deletes by composite key, not by asset id alone", async () => {
      const { db, prepare, bind } = makeDb();
      await removeAssetRef(db, "asset-1", "proj-2");
      const sql = prepare.mock.calls[0][0] as string;
      expect(sql).toMatch(/DELETE FROM asset_refs/);
      expect(sql).toMatch(/asset_id\s*=\s*\?/);
      expect(sql).toMatch(/project_id\s*=\s*\?/);
      expect(bind.mock.calls[0]).toEqual(["asset-1", "proj-2"]);
    });
  });

  describe("getAssetByTaskId", () => {
    it("selects via source_task_id index and returns the row", async () => {
      const { db, prepare, bind, first } = makeDb();
      first.mockResolvedValueOnce({
        id: "asset-1",
        userId: "u",
        kind: "image",
        srcR2Key: "k",
        coverR2Key: null,
        metadata: null,
        sourceModel: null, sourcePrompt: null, sourceTaskId: "task-7",
        createdAt: 1, updatedAt: 1,
      });

      const result = await getAssetByTaskId(db, "task-7");
      expect(result?.id).toBe("asset-1");
      expect(prepare.mock.calls[0][0]).toMatch(/source_task_id\s*=\s*\?/);
      expect(bind.mock.calls[0][0]).toBe("task-7");
    });

    it("returns null when no row found", async () => {
      const { db } = makeDb(); // first mock defaults to null
      expect(await getAssetByTaskId(db, "missing")).toBeNull();
    });
  });

  describe("getAssetById", () => {
    it("selects by primary key", async () => {
      const { db, prepare, bind } = makeDb();
      await getAssetById(db, "asset-xyz");
      expect(prepare.mock.calls[0][0]).toMatch(/WHERE id\s*=\s*\?/);
      expect(bind.mock.calls[0][0]).toBe("asset-xyz");
    });
  });

  describe("updateAssetCover", () => {
    it("updates cover_r2_key and bumps updated_at", async () => {
      const { db, prepare, bind } = makeDb();
      await updateAssetCover(db, "asset-1", "covers/a.jpg");
      const sql = prepare.mock.calls[0][0] as string;
      expect(sql).toMatch(/UPDATE assets SET cover_r2_key = \?, updated_at = \?/);
      expect(bind.mock.calls[0][0]).toBe("covers/a.jpg");
      expect(typeof bind.mock.calls[0][1]).toBe("number");
      expect(bind.mock.calls[0][2]).toBe("asset-1");
    });
  });

  describe("getProjectOwner", () => {
    it("returns owner id when project exists", async () => {
      const { db, first } = makeDb();
      first.mockResolvedValueOnce({ ownerId: "user-9" });
      expect(await getProjectOwner(db, "proj-1")).toBe("user-9");
    });

    it("returns null when project missing", async () => {
      const { db } = makeDb();
      expect(await getProjectOwner(db, "missing")).toBeNull();
    });

    it("returns null on DB error rather than throwing", async () => {
      const { db, first } = makeDb();
      first.mockRejectedValueOnce(new Error("D1 unavailable"));
      expect(await getProjectOwner(db, "proj-1")).toBeNull();
    });
  });
});
