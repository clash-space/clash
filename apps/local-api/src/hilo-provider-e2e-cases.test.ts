import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createHiloProviderCases,
  prepareHiloProviderTestPlugin,
  selectHiloProviderCases,
} from "./hilo-provider-e2e-cases.js";

describe("Hilo Hub provider backend case coverage", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ));
  });

  it("defines the required H3 and Seedance audio-reference backend cases", async () => {
    const cases = await createHiloProviderCases();

    expect(cases.map(({ id, modelId, type, expect: expected }) => ({
      id,
      modelId,
      type,
      expected,
    }))).toEqual([
      {
        id: "hilo-minimax-h3-image-mp3",
        modelId: "minimax-h3",
        type: "video_gen",
        expected: { kind: "video", mediaType: "video/mp4" },
      },
      {
        id: "hilo-seedance-2-audio-reference",
        modelId: "seedance-2-ref",
        type: "video_gen",
        expected: { kind: "video", mediaType: "video/mp4" },
      },
    ]);
    expect(cases.map((candidate) =>
      candidate.refs?.map(({ kind, mediaType }) => ({ kind, mediaType })),
    )).toEqual([
      [
        { kind: "image", mediaType: "image/png" },
        { kind: "audio", mediaType: "audio/mpeg" },
      ],
      [
        { kind: "image", mediaType: "image/png" },
        { kind: "audio", mediaType: "audio/mpeg" },
      ],
    ]);
  });

  it("selects costly live cases explicitly and rejects unknown targets", async () => {
    const cases = await createHiloProviderCases();

    expect(selectHiloProviderCases(
      cases,
      "hilo-seedance-2-audio-reference,hilo-seedance-2-audio-reference",
    ).map(({ id }) => id)).toEqual(["hilo-seedance-2-audio-reference"]);
    expect(() => selectHiloProviderCases(cases, "hilo-unknown"))
      .toThrow(/Unknown CLASH_PROVIDER_E2E_TARGETS.*hilo-unknown/);
  });

  it("activates the Hilo provider and its two target bindings in an isolated actions root", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-hilo-provider-test-"));
    temporaryRoots.push(root);
    const actionsRoot = join(root, "actions");

    await prepareHiloProviderTestPlugin({
      actionsRoot,
      dataDir: join(root, "local-api"),
    });

    const manifest = JSON.parse(
      await readFile(join(actionsRoot, "hrhrng.hub", "manifest.json"), "utf8"),
    ) as { id?: string };
    expect(manifest.id).toBe("hrhrng.hub");
    const provider = JSON.parse(await readFile(
      join(actionsRoot, "hrhrng.hub", "providers", "hilo-hub.json"),
      "utf8",
    )) as { spec?: { id?: string } };
    const h3 = JSON.parse(await readFile(
      join(actionsRoot, "hrhrng.hub", "bindings", "minimax-h3.json"),
      "utf8",
    )) as { spec?: { modelId?: string } };
    const seedance = JSON.parse(await readFile(
      join(actionsRoot, "hrhrng.hub", "bindings", "seedance-2-ref.json"),
      "utf8",
    )) as {
      spec?: {
        modelId?: string;
        referenceBinding?: { type?: string };
      };
    };
    expect(provider.spec?.id).toBe("hilo-hub");
    expect(h3.spec?.modelId).toBe("minimax-h3");
    expect(seedance.spec?.modelId).toBe("seedance-2-ref");
    expect(seedance.spec?.referenceBinding).toEqual({
      type: "grouped-references",
    });
  });
});
