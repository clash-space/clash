import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalSyncConfigStore } from "./sync-config";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-sync-config-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("local sync config", () => {
  it("stores remote sync tokens in an owner-only local config file", async () => {
    const store = createLocalSyncConfigStore({ dataDir, env: {} });

    await store.updateFromRequest({
      mode: "cloud-sync",
      remote_loro_url: "https://sync.example",
      remote_loro_token: "secret-token",
    });

    const info = await stat(join(dataDir, "sync.json"));
    expect(info.mode & 0o777).toBe(0o600);
    await expect(store.getPublicConfig()).resolves.toMatchObject({
      remote_loro: {
        has_token: true,
        source: "config",
      },
    });
  });

  it("stores explicit sync capability readiness separately from remote credentials", async () => {
    const store = createLocalSyncConfigStore({ dataDir, env: {} });

    await store.updateFromRequest({
      mode: "cloud-sync",
      remote_loro_url: "https://sync.example",
      capabilities: {
        canvas: true,
        room: true,
        asset_metadata: true,
        revision_content: true,
      },
    });

    await expect(store.getPublicConfig()).resolves.toMatchObject({
      mode: "cloud-sync",
      capabilities: {
        canvas: true,
        room: true,
        asset_metadata: true,
        revision_content: true,
      },
    });
  });
});
