import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalPluginAssetStagingStore,
  pluginOutputProjectAssetId,
} from "./local-plugin-asset-staging";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

async function store() {
  const dataDir = await mkdtemp(join(tmpdir(), "clash-plugin-staging-"));
  cleanups.push(dataDir);
  return {
    dataDir,
    store: createLocalPluginAssetStagingStore({ dataDir }),
  };
}

describe("local plugin Asset staging", () => {
  it("chooses a stable Project-scoped output identity without exposing the Resource digest", () => {
    const first = pluginOutputProjectAssetId({
      projectId: "project-a",
      taskId: "run-1",
      slot: "media",
    });
    expect(first).toBe(pluginOutputProjectAssetId({
      projectId: "project-a",
      taskId: "run-1",
      slot: "media",
    }));
    expect(first).not.toBe(pluginOutputProjectAssetId({
      projectId: "project-b",
      taskId: "run-1",
      slot: "media",
    }));
    expect(first).toMatch(/^plugin-output:[a-f0-9]{64}$/);
    expect(first).not.toContain("sha256:");
  });

  it("installs immutable bytes once and persists a project-scoped receipt", async () => {
    const fixture = await store();
    const staged = await fixture.store.stage({
      projectId: "project-a",
      taskId: "run-1",
      slot: "media",
      pluginId: "clash.minimax",
      pluginVersion: "1.0.0",
      invocationId: "invoke-1",
      kind: "audio",
      mediaType: "audio/mpeg",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(staged).toMatchObject({
      projectId: "project-a",
      taskId: "run-1",
      slot: "media",
      kind: "audio",
      mediaType: "audio/mpeg",
      projection: {
        resource: {
          kind: "audio",
          byteLength: 3,
          contentType: "audio/mpeg",
          digest: { algorithm: "sha256" },
        },
      },
    });
    await expect(readFile(staged.projection.path)).resolves.toEqual(Buffer.from([1, 2, 3]));

    const reopened = createLocalPluginAssetStagingStore({ dataDir: fixture.dataDir });
    await expect(reopened.resolve({
      projectId: "project-a",
      projectAssetId: staged.projectAssetId,
    })).resolves.toMatchObject({
      resourceId: staged.resourceId,
      projectAssetId: staged.projectAssetId,
    });
    await expect(reopened.resolve({
      projectId: "project-b",
      projectAssetId: staged.projectAssetId,
    })).resolves.toBeUndefined();
  });

  it("keeps the first durable receipt when an ambiguous Provider retry returns different bytes", async () => {
    const fixture = await store();
    const first = await fixture.store.stage({
      projectId: "project-a",
      taskId: "run-1",
      slot: "media",
      pluginId: "clash.google",
      pluginVersion: "1.0.0",
      invocationId: "invoke-1",
      kind: "image",
      mediaType: "image/png",
      bytes: new Uint8Array([1]),
    });
    const retried = await fixture.store.stage({
      projectId: "project-a",
      taskId: "run-1",
      slot: "media",
      pluginId: "clash.google",
      pluginVersion: "1.0.0",
      invocationId: "invoke-2",
      kind: "image",
      mediaType: "image/png",
      bytes: new Uint8Array([2]),
    });

    expect(retried.projectAssetId).toBe(first.projectAssetId);
    expect(retried.resourceId).toBe(first.resourceId);
    await expect(readFile(retried.projection.path)).resolves.toEqual(Buffer.from([1]));
  });
});
