import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models";
import { listModelCatalogEntries } from "./model-routing";
import {
  asrModelValue,
  isLocalAsrModelEntry,
  listLocalSpeechModelCards,
  localSpeechCapability,
  resolveLocalSpeechModelId,
  type LocalSpeechCatalogEntry,
} from "./local-speech-catalog";

function catalogEntries(): LocalSpeechCatalogEntry[] {
  return listModelCatalogEntries({}) as unknown as LocalSpeechCatalogEntry[];
}

describe("local speech catalog selectors", () => {
  it("finds every shipped local ASR card, Whisper included", () => {
    const cards = listLocalSpeechModelCards(catalogEntries(), "speech-to-text");
    const ids = cards.map((card) => card.cardId);

    expect(ids).toContain("whisper-small-asr");
    expect(ids).toContain("whisper-large-v3-turbo-asr");
    expect(ids).toContain("sensevoice-small-asr");
    expect(cards.every((card) => card.capability === "speech-to-text")).toBe(true);
  });

  it("carries the provider and description a user needs to choose", () => {
    const cards = listLocalSpeechModelCards(catalogEntries(), "speech-to-text");
    const whisper = cards.find((card) => card.cardId === "whisper-small-asr");

    expect(whisper?.name).toBe("Whisper Small");
    expect(whisper?.provider).toBe("OpenAI");
    expect(whisper?.description).toMatch(/word-level timestamps/i);
    expect(whisper?.model).toBe("mlx-community/whisper-small-mlx");
  });

  it("maps a catalog card id to the runtime id the installer actually wants", () => {
    const entries = catalogEntries();

    expect(resolveLocalSpeechModelId(entries, "speech-to-text", "whisper-small-asr")).toBe(
      "mlx-community/whisper-small-mlx",
    );
    // A runtime id already in hand resolves to itself, so callers can pass either.
    expect(
      resolveLocalSpeechModelId(entries, "speech-to-text", "mlx-community/whisper-small-mlx"),
    ).toBe("mlx-community/whisper-small-mlx");
    expect(resolveLocalSpeechModelId(entries, "speech-to-text", "not-a-model")).toBeUndefined();
  });

  it("reads a card's runtime id from defaultParams when no route is selected", () => {
    const card = MODEL_CARDS.find((candidate) => candidate.id === "whisper-small-asr");
    const entry = {
      model: card as unknown as LocalSpeechCatalogEntry["model"],
      candidateProviders: ["local"],
      routes: [],
    } satisfies LocalSpeechCatalogEntry;

    expect(isLocalAsrModelEntry(entry)).toBe(true);
    expect(localSpeechCapability(entry)).toBe("speech-to-text");
    expect(asrModelValue(entry)).toBe("mlx-community/whisper-small-mlx");
  });
});
