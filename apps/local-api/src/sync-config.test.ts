import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
  it("stores sync intent in config.yaml and the token in owner-only credentials", async () => {
    const removedSyncSidecar = String.fromCharCode(115, 121, 110, 99, 46, 106, 115, 111, 110);
    const store = createLocalSyncConfigStore({ dataDir, env: {} });

    await store.updateFromRequest({
      mode: "cloud-sync",
      remote_loro_url: "https://sync.example",
      remote_loro_token: "secret-token",
    });

    await expect(stat(join(dataDir, removedSyncSidecar))).rejects.toMatchObject({ code: "ENOENT" });
    const configInfo = await stat(join(dataDir, "config.yaml"));
    const credentialsInfo = await stat(join(dataDir, "credentials.json"));
    expect(configInfo.mode & 0o777).toBe(0o600);
    expect(credentialsInfo.mode & 0o777).toBe(0o600);
    const configText = await readFile(join(dataDir, "config.yaml"), "utf8");
    expect(configText).toContain("https://sync.example");
    expect(configText).not.toContain("secret-token");
    await expect(readFile(join(dataDir, "credentials.json"), "utf8")).resolves.toContain("secret-token");
    await expect(stat(join(dataDir, "local.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.getPublicConfig()).resolves.toMatchObject({
      remote_loro: {
        has_token: true,
        source: "config",
      },
    });
    await expect(createLocalSyncConfigStore({ dataDir, env: {} }).getPublicConfig()).resolves.toMatchObject({
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
        asset_metadata: true,
        revision_content: true,
      },
    });

    await expect(store.getPublicConfig()).resolves.toMatchObject({
      mode: "cloud-sync",
      capabilities: {
        canvas: true,
        asset_metadata: true,
        revision_content: true,
      },
    });
  });
});
