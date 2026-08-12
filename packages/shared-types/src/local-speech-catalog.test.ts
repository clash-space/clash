import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models.js";
import { listModelCatalogEntries } from "./model-routing.js";
import {
  asrModelValue,
  isLocalAsrModelEntry,
  listLocalSpeechModelCards,
  localSpeechCapability,
  resolveLocalSpeechModelId,
  type LocalSpeechCatalogEntry,
} from "./local-speech-catalog.js";

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

/**
 * Transcription is recognised by what it does, not by a kind of its own.
 *
 * `kind: 'asr'` was a fifth member of the model kinds, sitting beside image, video, audio and text.
 * The other four name what a card produces; `asr` named a technique, and all five cards under it
 * produce text. Removing it means this predicate can no longer ask for it.
 *
 * The honest replacement is the shape those cards actually declare: audio is their only prompt
 * modality. That is what separates transcription from a chat model -- Gemini accepts audio too, but
 * it also accepts text, because it converses about a recording rather than transcribing it. A
 * predicate that only asked "accepts audio" would sweep those four Gemini cards into the local
 * speech installer, which offers to download MLX weights for them.
 */
describe("asr entries after the kind is gone", () => {
  it("still finds a transcription card once its kind is text", () => {
    const whisper = MODEL_CARDS.find((card) => card.id === "whisper-small-asr");
    expect(whisper?.kind).toBe("text");

    const entry = {
      model: whisper as unknown as LocalSpeechCatalogEntry["model"],
      candidateProviders: ["local"],
      routes: [],
    } satisfies LocalSpeechCatalogEntry;

    expect(isLocalAsrModelEntry(entry)).toBe(true);
  });

  it("does not treat a multimodal text model as transcription", () => {
    // Gemini declares `promptModalities: ['text','image','video','audio']`. It produces text and
    // accepts audio, so every weaker predicate matches it.
    const gemini = MODEL_CARDS.find((card) => card.id === "gemini-3.1-pro");
    expect(gemini?.input.promptModalities).toContain("audio");

    const entry = {
      model: gemini as unknown as LocalSpeechCatalogEntry["model"],
      candidateProviders: ["local"],
      routes: [],
    } satisfies LocalSpeechCatalogEntry;

    expect(isLocalAsrModelEntry(entry)).toBe(false);
  });

  it("does not treat an audio-to-audio model as transcription", () => {
    // Caught by mutation: dropping the "produces text" half of the predicate passed every test,
    // because no shipped card takes audio alone and produces something other than text. A voice
    // converter, a denoiser or a stem splitter is exactly that shape -- audio in, audio out, no way
    // to prompt it with words -- and one would have been offered MLX transcription weights.
    const entry = {
      model: {
        id: "voice-convert-1",
        kind: "audio",
        input: { requiresPrompt: false, promptModalities: ["audio"], inputMode: { audios: { max: 1 } } },
      },
      candidateProviders: ["local"],
      routes: [],
    } satisfies LocalSpeechCatalogEntry;

    expect(isLocalAsrModelEntry(entry)).toBe(false);
    expect(localSpeechCapability(entry)).toBeNull();
  });

  it("finds every shipped local transcription card by that shape alone", () => {
    const ids = listLocalSpeechModelCards(catalogEntries(), "speech-to-text").map((c) => c.cardId);
    for (const id of ["whisper-small-asr", "whisper-large-v3-turbo-asr", "sensevoice-small-asr"]) {
      expect(ids).toContain(id);
    }
    // Nothing that merely converses about audio may appear here.
    expect(ids).not.toContain("gemini-3.1-pro");
  });
});
