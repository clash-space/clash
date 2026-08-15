import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getDocumentKindDefinition,
  listDocumentKindDefinitions,
  parseDocumentBody,
  registerDocumentKind,
} from "./document-kind-registry.js";

const transcript = {
  schemaVersion: 1,
  kind: "clash.asr.timed-transcript",
  timebase: "milliseconds",
  alignment: "word",
  text: "hello world",
  backendId: "test-asr",
  modelId: "test-model",
  durationMs: 900,
  language: "en",
  words: [
    { id: "w1", text: "hello", startMs: 0, endMs: 400 },
    { id: "w2", text: "world", startMs: 500, endMs: 900 },
  ],
  segments: [
    {
      id: "s1",
      text: "hello world",
      startMs: 0,
      endMs: 900,
      wordIds: ["w1", "w2"],
    },
  ],
};

describe("Document kind registry", () => {
  it("declares transcript as one versioned, product-standard Document body", () => {
    expect(getDocumentKindDefinition("media.transcript", 1)).toMatchObject({
      kind: "media.transcript",
      schemaVersion: 1,
      mutability: "versioned",
      projection: { format: "json", editable: true },
      allowedAttachmentTargets: [
        "project-asset",
        "generator-revision",
        "action-run",
      ],
      productConsumers: ["captions", "transcript-editing", "search"],
    });
    expect(parseDocumentBody("media.transcript", 1, transcript)).toEqual(
      transcript,
    );
    expect(() =>
      parseDocumentBody("media.transcript", 1, {
        ...transcript,
        words: [{ id: "w1", text: "hello", startMs: 500, endMs: 100 }],
      }),
    ).toThrow();
  });

  it("keeps immutable receipts read-only while versioned authored documents remain editable", () => {
    expect(getDocumentKindDefinition("media.render-lineage", 1)).toMatchObject({
      mutability: "immutable",
      projection: { editable: false },
    });
    expect(getDocumentKindDefinition("media.description", 1)).toMatchObject({
      mutability: "versioned",
      projection: { editable: true },
    });
  });

  it("allows a plugin/workspace to declare storage and projection without granting product semantics", () => {
    registerDocumentKind({
      definition: {
        kind: "workspace.shot-notes",
        schemaVersion: 1,
        mutability: "versioned",
        projection: { format: "json", editable: true },
        allowedAttachmentTargets: ["project-asset"],
        productConsumers: [],
      },
      schema: z
        .object({ schemaVersion: z.literal(1), notes: z.array(z.string()) })
        .strict(),
    });

    expect(
      parseDocumentBody("workspace.shot-notes", 1, {
        schemaVersion: 1,
        notes: ["hold the wide shot"],
      }),
    ).toEqual({ schemaVersion: 1, notes: ["hold the wide shot"] });
    expect(
      listDocumentKindDefinitions().find(
        ({ kind }) => kind === "workspace.shot-notes",
      )?.productConsumers,
    ).toEqual([]);
  });

  it("rejects undeclared versions instead of accepting unchecked JSON", () => {
    expect(() => parseDocumentBody("media.transcript", 2, transcript)).toThrow(
      /undeclared Document kind/i,
    );
  });
});
