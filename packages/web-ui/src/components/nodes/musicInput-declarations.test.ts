import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "@clash/shared-types";

/**
 * The lyrics box is drawn for a card that declares it takes lyrics.
 *
 * ActionBadge decided this with `selectedModel?.task === 'music-generation'`. That field is gone --
 * producing one class of output is one action, so speech and music are both `audio` and the
 * difference between them is parameters. `musicInput` is the parameter declaration: it names where
 * lyrics go (`lyricsTarget`, `lyricsParam`) and how long they may be, and the textarea already read
 * `selectedModel?.musicInput?.maxLyricsCharacters` for its own maxLength.
 *
 * The two did not agree. `lyria-3-pro` was tagged `music-generation` and declares no `musicInput`,
 * so the old predicate drew it a lyrics box with an undefined maxLength whose contents were then
 * sent to a model that declares no lyrics parameter. Reading the declaration fixes that case rather
 * than preserving it.
 */
/*
 * Scope: these pin the card declarations the predicate reads, not ActionBadge's own branch.
 * Mutating `isMusicModel` to `kind === 'audio'` does not fail them -- the component is a 3,000-line
 * React node that would have to be mounted to cover that one line. What they do guarantee is the
 * half that actually rotted: that `musicInput` is declared by exactly the cards that take lyrics,
 * which is what makes the one-line predicate correct.
 */
describe("the musicInput declaration the lyrics box reads", () => {
  const byId = (id: string) => MODEL_CARDS.find((card) => card.id === id);

  it("is declared by the two cards that actually take lyrics", () => {
    expect(byId("minimax-music-3")?.musicInput).toMatchObject({ lyricsParam: "lyrics" });
    expect(byId("suno-v5.5")?.musicInput).toBeDefined();
  });

  it("is not declared by a music model that takes no lyrics", () => {
    // The case the old flag got wrong: music by any reasonable description, but instrumental --
    // there is nowhere for a lyric to go.
    const lyria = byId("lyria-3-pro");
    expect(lyria?.kind).toBe("audio");
    expect(lyria?.musicInput).toBeUndefined();
  });

  it("is not declared by speech cards", () => {
    for (const id of ["gemini-2.5-pro-tts", "minimax-tts", "elevenlabs-tts"]) {
      expect(byId(id)?.musicInput, id).toBeUndefined();
    }
  });

  it("leaves no card carrying a task field to fall back on", () => {
    // If any card still had one, a predicate could quietly keep reading it and this whole
    // convergence would hold only for the cards someone happened to check.
    expect(MODEL_CARDS.filter((card) => "task" in card).map((card) => card.id)).toEqual([]);
  });
});
