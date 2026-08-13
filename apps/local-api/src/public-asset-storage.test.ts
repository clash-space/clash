import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PublicAssetStorageConfigError,
  createPublicAssetStorageService,
  type PublicAssetStorageBackend,
  type PublicAssetStorageBackendConfig,
} from "./public-asset-storage.js";

function backend(): PublicAssetStorageBackend {
  return {
    testConnection: vi.fn(async () => undefined),
    publish: vi.fn(async ({ key }) => ({
      key,
      url: `https://objects.example.test/${key}?signature=test`,
      expiresAt: "2026-08-13T12:00:00.000Z",
    })),
    delete: vi.fn(async () => undefined),
  };
}

describe("public Asset storage", () => {
  it("persists BYOS secrets outside config.yaml and never returns them", async () => {
    // Regression caught: serialising the request object directly would put the S3 secret in both
    // the settings response and config.yaml.
    const dataDir = await mkdtemp(join(tmpdir(), "clash-public-storage-"));
    const created: PublicAssetStorageBackendConfig[] = [];
    const service = createPublicAssetStorageService({
      dataDir,
      createByosBackend(config) {
        created.push(config);
        return backend();
      },
    });

    const saved = await service.updateFromRequest({
      mode: "byos",
      provider: "r2",
      account_id: "account-123",
      bucket: "clash-assets",
      key_prefix: "temporary",
      access_key_id: "R2_ACCESS_KEY",
      secret_access_key: "R2_SECRET_KEY",
    });

    expect(saved).toMatchObject({
      mode: "byos",
      available: true,
      provider: "r2",
      account_id: "account-123",
      bucket: "clash-assets",
      region: "auto",
      has_access_key_id: true,
      has_secret_access_key: true,
      managed: { available: false, authenticated: false },
    });
    expect(JSON.stringify(saved)).not.toContain("R2_ACCESS_KEY");
    expect(JSON.stringify(saved)).not.toContain("R2_SECRET_KEY");

    const config = await readFile(join(dataDir, "config.yaml"), "utf8");
    const credentials = await readFile(
      join(dataDir, "credentials.json"),
      "utf8",
    );
    expect(config).not.toContain("R2_ACCESS_KEY");
    expect(config).not.toContain("R2_SECRET_KEY");
    expect(credentials).toContain("R2_ACCESS_KEY");
    expect(credentials).toContain("R2_SECRET_KEY");

    await service.testConnection();
    expect(created.at(-1)).toMatchObject({
      endpoint: "https://account-123.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "clash-assets",
      accessKeyId: "R2_ACCESS_KEY",
      secretAccessKey: "R2_SECRET_KEY",
    });
  });

  it("uses an available authenticated managed backend for the same capability", async () => {
    // Regression caught: tying the dependency to S3 configuration would make a future signed-in
    // Clash storage backend unable to satisfy the same plugin contract.
    const dataDir = await mkdtemp(join(tmpdir(), "clash-managed-storage-"));
    const managedBackend = backend();
    const service = createPublicAssetStorageService({
      dataDir,
      managed: {
        available: true,
        authenticated: true,
        backend: managedBackend,
      },
    });

    await service.updateFromRequest({ mode: "managed" });
    expect(await service.getPublicConfig()).toMatchObject({
      mode: "managed",
      available: true,
      managed: { available: true, authenticated: true },
    });

    const published = await service.publish({
      key: "plugin/invocation/reference.png",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    expect(published.url).toContain("objects.example.test");
    expect(managedBackend.publish).toHaveBeenCalledOnce();
  });

  it("does not offer managed storage until the host actually provides it", async () => {
    // Regression caught: an unauthenticated local build must not render a managed option whose
    // save action can only fail.
    const dataDir = await mkdtemp(join(tmpdir(), "clash-no-managed-storage-"));
    const service = createPublicAssetStorageService({ dataDir });

    await expect(
      service.updateFromRequest({ mode: "managed" }),
    ).rejects.toBeInstanceOf(PublicAssetStorageConfigError);
    expect((await service.getPublicConfig()).managed).toEqual({
      available: false,
      authenticated: false,
    });
  });

  it("observes a later login without restarting the local Host", async () => {
    // Regression caught: snapshotting login state in the service constructor would keep the free
    // managed option hidden until the daemon restarted after sign-in.
    const dataDir = await mkdtemp(join(tmpdir(), "clash-managed-login-storage-"));
    const managedBackend = backend();
    let authenticated = false;
    const service = createPublicAssetStorageService({
      dataDir,
      managed: async () => ({
        available: true,
        authenticated,
        ...(authenticated ? { backend: managedBackend } : {}),
      }),
    });

    expect((await service.getPublicConfig()).managed.authenticated).toBe(false);
    authenticated = true;
    expect((await service.getPublicConfig()).managed.authenticated).toBe(true);
    await expect(service.updateFromRequest({ mode: "managed" })).resolves
      .toMatchObject({ mode: "managed", available: true });
  });
});
