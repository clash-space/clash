/**
 * Integration test: real Worker + real D1 + real R2 (miniflare).
 *
 * Walks the asset lifecycle the way a client would:
 *   1. seed a project owned by the test user
 *   2. POST /api/v1/assets        → create row + asset_refs
 *   3. GET  /api/v1/assets/:id    → read back full record
 *   4. PATCH /api/v1/assets/:id/cover → set cover_r2_key
 *   5. DELETE /api/v1/assets/:id/ref?projectId=... → drop the ref
 *
 * Verifies side effects against the live D1 binding.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";

const USER_ID = "user-int-1";
const PROJECT_ID = "proj-int-1";

async function seedProject() {
  // Insert a project owned by USER_ID so assertProjectOwner passes.
  await env.DB
    .prepare(
      `INSERT OR REPLACE INTO project (id, owner_id, name, created_at, updated_at)
       VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))`,
    )
    .bind(PROJECT_ID, USER_ID, "Integration test project")
    .run();
}

function authed(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      "x-user-id": USER_ID,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  };
}

describe("assets integration (real D1 + Worker)", () => {
  beforeEach(async () => {
    await seedProject();
  });

  it("full CRUD lifecycle: create → read → patch cover → drop ref", async () => {
    // 1. POST — create asset
    const createRes = await SELF.fetch("https://api/api/v1/assets", authed({
      method: "POST",
      body: JSON.stringify({
        projectId: PROJECT_ID,
        kind: "image",
        srcR2Key: "uploads/integration-test.png",
        bytes: 4096,
        width: 1024,
        height: 768,
        sourceModel: "nano-banana-2",
        sourcePrompt: "an integration test cat",
      }),
    }));
    expect(createRes.status).toBe(200);
    const { id: assetId } = await createRes.json<{ id: string }>();
    expect(assetId).toBeTruthy();

    // Verify row landed in D1
    const row = await env.DB
      .prepare(`SELECT user_id as userId, kind, src_r2_key as srcR2Key, bytes, width, height FROM assets WHERE id = ?`)
      .bind(assetId)
      .first<{ userId: string; kind: string; srcR2Key: string; bytes: number; width: number; height: number }>();
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(USER_ID);
    expect(row?.kind).toBe("image");
    expect(row?.srcR2Key).toBe("uploads/integration-test.png");
    expect(row?.bytes).toBe(4096);

    // Verify junction row landed
    const ref = await env.DB
      .prepare(`SELECT asset_id as assetId, project_id as projectId FROM asset_refs WHERE asset_id = ? AND project_id = ?`)
      .bind(assetId, PROJECT_ID)
      .first<{ assetId: string; projectId: string }>();
    expect(ref).not.toBeNull();

    // 2. GET — read back
    const getRes = await SELF.fetch(`https://api/api/v1/assets/${assetId}`, { headers: { "x-user-id": USER_ID } });
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json<Record<string, unknown>>();
    expect(fetched.id).toBe(assetId);
    expect(fetched.srcR2Key).toBe("uploads/integration-test.png");
    expect(fetched.coverR2Key).toBeNull();
    expect(fetched.sourceModel).toBe("nano-banana-2");

    // 3. PATCH cover
    const patchRes = await SELF.fetch(`https://api/api/v1/assets/${assetId}/cover`, authed({
      method: "PATCH",
      body: JSON.stringify({ coverR2Key: "covers/integration-test-cover.jpg" }),
    }));
    expect(patchRes.status).toBe(200);

    const afterPatch = await env.DB
      .prepare(`SELECT cover_r2_key as coverR2Key FROM assets WHERE id = ?`)
      .bind(assetId)
      .first<{ coverR2Key: string }>();
    expect(afterPatch?.coverR2Key).toBe("covers/integration-test-cover.jpg");

    // 4. DELETE ref
    const delRes = await SELF.fetch(
      `https://api/api/v1/assets/${assetId}/ref?projectId=${PROJECT_ID}`,
      authed({ method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);

    const refAfter = await env.DB
      .prepare(`SELECT asset_id FROM asset_refs WHERE asset_id = ? AND project_id = ?`)
      .bind(assetId, PROJECT_ID)
      .first();
    expect(refAfter).toBeNull();

    // Asset row itself stays (mark-and-sweep would reclaim later).
    const assetAfter = await env.DB
      .prepare(`SELECT id FROM assets WHERE id = ?`)
      .bind(assetId)
      .first<{ id: string }>();
    expect(assetAfter?.id).toBe(assetId);
  });

  it("rejects POST without x-user-id (401-ish: 400 with auth error)", async () => {
    const res = await SELF.fetch("https://api/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, kind: "image", srcR2Key: "k" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects POST when caller does not own the project", async () => {
    const res = await SELF.fetch("https://api/api/v1/assets", {
      method: "POST",
      headers: { "x-user-id": "someone-else", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        kind: "image",
        srcR2Key: "uploads/will-not-land.png",
      }),
    });
    expect(res.status).toBe(400);

    // Confirm nothing landed
    const count = await env.DB
      .prepare(`SELECT COUNT(*) as n FROM assets WHERE src_r2_key = ?`)
      .bind("uploads/will-not-land.png")
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("403 when GET caller is not the asset owner", async () => {
    // Owner creates an asset
    const createRes = await SELF.fetch("https://api/api/v1/assets", authed({
      method: "POST",
      body: JSON.stringify({ projectId: PROJECT_ID, kind: "image", srcR2Key: "uploads/x.png" }),
    }));
    const { id } = await createRes.json<{ id: string }>();

    // Attacker tries to read
    const stealRes = await SELF.fetch(`https://api/api/v1/assets/${id}`, {
      headers: { "x-user-id": "attacker" },
    });
    expect(stealRes.status).toBe(403);
  });

  it("M:N: same asset can be ref'd from a second project (cross-project import simulation)", async () => {
    // Owner creates asset under project 1
    const c1 = await SELF.fetch("https://api/api/v1/assets", authed({
      method: "POST",
      body: JSON.stringify({ projectId: PROJECT_ID, kind: "image", srcR2Key: "uploads/shared.png" }),
    }));
    const { id: assetId } = await c1.json<{ id: string }>();

    // Seed a second project owned by same user
    const PROJECT_2 = "proj-int-2";
    await env.DB
      .prepare(
        `INSERT OR REPLACE INTO project (id, owner_id, name, created_at, updated_at)
         VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))`,
      )
      .bind(PROJECT_2, USER_ID, "Second project")
      .run();

    // POST again with same id → should add a second asset_refs row, not duplicate the asset
    const c2 = await SELF.fetch("https://api/api/v1/assets", authed({
      method: "POST",
      body: JSON.stringify({
        id: assetId,
        projectId: PROJECT_2,
        kind: "image",
        srcR2Key: "uploads/shared.png",
      }),
    }));
    expect(c2.status).toBe(200);

    // assets should still have exactly one row for this id
    const assetCount = await env.DB
      .prepare(`SELECT COUNT(*) as n FROM assets WHERE id = ?`)
      .bind(assetId)
      .first<{ n: number }>();
    expect(assetCount?.n).toBe(1);

    // asset_refs should have two rows (one per project)
    const refRows = await env.DB
      .prepare(`SELECT project_id FROM asset_refs WHERE asset_id = ? ORDER BY project_id`)
      .bind(assetId)
      .all<{ project_id: string }>();
    expect(refRows.results.map(r => r.project_id).sort()).toEqual([PROJECT_ID, PROJECT_2].sort());

    // Drop ref from project 1; project 2 still has it
    await SELF.fetch(`https://api/api/v1/assets/${assetId}/ref?projectId=${PROJECT_ID}`, authed({ method: "DELETE" }));
    const remaining = await env.DB
      .prepare(`SELECT project_id FROM asset_refs WHERE asset_id = ?`)
      .bind(assetId)
      .all<{ project_id: string }>();
    expect(remaining.results).toHaveLength(1);
    expect(remaining.results[0].project_id).toBe(PROJECT_2);
  });
});
