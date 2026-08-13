import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createLocalApiApp } from "./app.js";
import {
  createPublicAssetStorageService,
  type PublicAssetStorageBackend,
} from "./public-asset-storage.js";

it("configures and tests machine-level public storage without exposing secrets", async () => {
  // Regression caught: a settings-only frontend state neither configures CLI/MCP's host nor gives
  // plugins a backend-enforced capability.
  const dataDir = await mkdtemp(join(tmpdir(), "clash-public-storage-route-"));
  const testConnection = vi.fn(async () => undefined);
  const storage = createPublicAssetStorageService({
    dataDir,
    createByosBackend: () => ({
      testConnection,
      publish: vi.fn() as PublicAssetStorageBackend["publish"],
      delete: vi.fn(async () => undefined),
    }),
  });
  const app = createLocalApiApp({ dataDir, publicAssetStorage: storage });

  const initial = await app.request("/api/v1/local/public-storage");
  expect(initial.status).toBe(200);
  expect(await initial.json()).toMatchObject({
    mode: "disabled",
    available: false,
    managed: { available: false, authenticated: false },
  });

  const updated = await app.request("/api/v1/local/public-storage", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "byos",
      provider: "tos",
      bucket: "clash-assets",
      region: "cn-beijing",
      access_key_id: "TOS_ACCESS_KEY",
      secret_access_key: "TOS_SECRET_KEY",
    }),
  });
  expect(updated.status).toBe(200);
  const body = await updated.json();
  expect(body).toMatchObject({
    mode: "byos",
    provider: "tos",
    available: true,
    has_access_key_id: true,
    has_secret_access_key: true,
  });
  expect(JSON.stringify(body)).not.toContain("TOS_ACCESS_KEY");
  expect(JSON.stringify(body)).not.toContain("TOS_SECRET_KEY");

  const tested = await app.request("/api/v1/local/public-storage/test", {
    method: "POST",
  });
  expect(tested.status).toBe(200);
  expect(await tested.json()).toEqual({ ok: true });
  expect(testConnection).toHaveBeenCalledOnce();
});
