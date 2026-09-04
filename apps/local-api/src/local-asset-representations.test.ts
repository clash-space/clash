import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAssetInspectionService } from "./local-asset-inspections.js";
import { createLocalAssetRepresentationService } from "./local-asset-representations.js";
import { createLocalResourceStore } from "./local-resource-store.js";

const temporaryDirectories: string[] = [];

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "clash-representation-run-"));
  temporaryDirectories.push(dataDir);
  const resources = createLocalResourceStore({ dataDir });
  const source = await resources.install({
    kind: "audio",
    contentType: "audio/wav",
    bytes: new TextEncoder().encode("immutable test audio"),
  });
  return {
    dataDir,
    source,
    assetInspection: createLocalAssetInspectionService({ dataDir }),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Local Asset representation durable runs", () => {
  it("coalesces concurrent requests onto one immutable source recipe", async () => {
    const { dataDir, source, assetInspection } = await fixture();
    const recipeRunner = vi.fn(async () => ({
      kind: "waveform" as const,
      role: "waveform" as const,
      peaks: new Array(128).fill(0.5),
    }));
    const service = createLocalAssetRepresentationService({
      dataDir,
      assetInspection,
      recipeRunner,
    });

    const [first, second] = await Promise.all([
      service.ensure(source.resource.id),
      service.ensure(source.resource.id),
    ]);

    expect(recipeRunner).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toEqual([
      expect.objectContaining({ role: "waveform", peaks: expect.any(Array) }),
    ]);
    await service.close();
  });

  it("reclaims a retryable run after Host restart without a new request", async () => {
    const { dataDir, source, assetInspection } = await fixture();
    let now = 1_000;
    const failingRunner = vi.fn(async () => {
      throw new Error("transient worker crash");
    });
    const first = createLocalAssetRepresentationService({
      dataDir,
      assetInspection,
      ownerId: "local-api:test-representations",
      now: () => now,
      recipeRunner: failingRunner,
    });

    await expect(first.ensure(source.resource.id)).resolves.toEqual([]);
    expect(failingRunner).toHaveBeenCalledTimes(1);
    await first.close();

    now = 2_001;
    const recoveredRunner = vi.fn(async () => ({
      kind: "waveform" as const,
      role: "waveform" as const,
      peaks: new Array(128).fill(0.75),
    }));
    const restarted = createLocalAssetRepresentationService({
      dataDir,
      assetInspection,
      ownerId: "local-api:test-representations",
      now: () => now,
      recipeRunner: recoveredRunner,
    });

    await restarted.start();

    expect(recoveredRunner).toHaveBeenCalledTimes(1);
    await expect(
      restarted.read(source.resource.id, "waveform"),
    ).resolves.toEqual(
      expect.objectContaining({
        role: "waveform",
        peaks: new Array(128).fill(0.75),
      }),
    );
    await restarted.close();
  });
});
