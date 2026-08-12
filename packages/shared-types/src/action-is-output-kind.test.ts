import { describe, expect, it } from "vitest";

import { pickDefaultModel } from "./model-capabilities.js";
import type { ModelCard } from "./models.js";

/**
 * An action is named by what it produces.
 *
 * The cards carried a `task` field holding `text-to-speech` or `music-generation`, written on 8 of
 * 50 cards. It looked like a classifier, but it was a patch: image and video cards distinguish
 * their variants by the shape of `inputMode` -- `{"startEnd":{}}`, `{"images":{"min":1,"max":1}}`,
 * an audio-driven mouth shape -- and two audio cards happened to share the same empty shape, so a
 * field was added to tell them apart.
 *
 * Producing one class of output is one action; the rest is parameters. So `audio` is one action,
 * speech and music alike, and nothing needs a second axis to say which.
 *
 * What `task` really carried was a default-picking preference, which survives here without
 * pretending to be a kind of action.
 */
const card = (over: Partial<ModelCard>): ModelCard => ({
  id: "m", name: "m", provider: "p", kind: "audio",
  parameters: {}, defaultParams: {},
  input: { requiresPrompt: true, promptModalities: ["text"], inputMode: {} },
  ...over,
} as ModelCard);

describe("action is the output kind", () => {
  it("picks an audio model without needing a task field", () => {
    const speech = card({ id: "speech", availableProviders: ["official"] });
    const music = card({ id: "music" });
    expect(pickDefaultModel({ outputKind: "audio", cards: [music, speech] })?.id).toBe("speech");
  });

  it("still returns an audio model when none is official", () => {
    // The old code fell through `textToSpeech[0] ?? compatible[0]`. Dropping the fallback would
    // leave audio with no default at all on a machine holding only third-party cards.
    const music = card({ id: "music" });
    expect(pickDefaultModel({ outputKind: "audio", cards: [music] })?.id).toBe("music");
  });

  it("does not read task", () => {
    // The field is gone. A card that still carries one must not be treated differently, or the
    // deletion is only half done and two vocabularies stay alive.
    const withTask = card({ id: "legacy", task: "music-generation" } as Partial<ModelCard>);
    const plain = card({ id: "plain" });
    expect(pickDefaultModel({ outputKind: "audio", cards: [withTask, plain] })?.id).toBe("legacy");
  });
});
