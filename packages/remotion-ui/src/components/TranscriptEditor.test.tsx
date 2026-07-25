// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorProvider, type EditorState } from "@master-clash/remotion-core";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());

describe("TranscriptEditor", () => {
  it("teaches first-time editors how transcript edits change the Timeline", async () => {
    const { TranscriptEditor } = await import("../index");

    render(
      <EditorProvider
        initialState={{
          fps: 30,
          tracks: [
            {
              id: "dialogue",
              name: "Dialogue",
              items: [
                {
                  id: "clip",
                  type: "video",
                  assetId: "speech",
                  src: "speech.mp4",
                  from: 0,
                  durationInFrames: 60,
                },
              ],
            },
          ],
          assetTranscripts: {
            speech: {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "speech",
              text: "Keep this",
              durationMs: 1200,
              words: [
                { id: "keep", text: "Keep", startMs: 0, endMs: 500 },
                { id: "this", text: "this", startMs: 520, endMs: 1000 },
              ],
            },
          },
        }}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    expect(
      screen.queryByText("Edit the words. The Timeline follows."),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show transcript guide" }),
    );
    expect(
      screen.getByText("Edit the words. The Timeline follows."),
    ).toBeTruthy();
    expect(screen.getByText(/drag across words to select/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Hide transcript guide" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide transcript guide" }),
    );
    expect(
      screen.queryByText("Edit the words. The Timeline follows."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(
      screen.getByText(/remove the matching clip range and close the gap/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Delete selected transcript words",
      }).textContent,
    ).toBe("Cut from Timeline");
  });

  it("renders word-aligned tokens as continuous prose instead of separate chips", async () => {
    const { TranscriptEditor } = await import("../index");
    const { container } = render(
      <EditorProvider
        initialState={{
          fps: 30,
          tracks: [
            {
              id: "dialogue",
              name: "Dialogue",
              items: [
                {
                  id: "clip",
                  type: "audio",
                  assetId: "speech",
                  src: "speech.wav",
                  from: 0,
                  durationInFrames: 60,
                },
              ],
            },
          ],
          assetTranscripts: {
            speech: {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "speech",
              text: "Hello world.",
              durationMs: 1200,
              words: [
                { id: "hello", text: "Hello", startMs: 0, endMs: 400 },
                { id: "world", text: "world", startMs: 420, endMs: 900 },
                { id: "period", text: ".", startMs: 900, endMs: 1000 },
              ],
            },
          },
        }}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    const paragraph = container.querySelector("[data-transcript-paragraph]");
    const clipGroup = container.querySelector("[data-transcript-clip-group]");
    expect(paragraph?.textContent).toBe("Hello world.");
    expect(clipGroup?.className).toContain("min-w-0");
    expect(paragraph?.className).toContain("w-full");
    expect(screen.getByRole("button", { name: "Hello" }).className).toContain("px-0");
    expect(screen.getByRole("button", { name: "Hello" }).className).not.toContain("px-[3px]");
  });

  it("breaks a long transcript into editorial paragraphs at sentence boundaries", async () => {
    const { TranscriptEditor } = await import("../index");
    const { container } = render(
      <EditorProvider
        initialState={{
          fps: 30,
          tracks: [{
            id: "dialogue",
            name: "Dialogue",
            items: [{
              id: "clip",
              type: "audio",
              assetId: "speech",
              src: "speech.wav",
              from: 0,
              durationInFrames: 90,
            }],
          }],
          assetTranscripts: {
            speech: {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "speech",
              text: "First sentence. Second sentence?",
              durationMs: 2200,
              words: [
                { id: "first", text: "First", startMs: 0, endMs: 400 },
                { id: "sentence-a", text: "sentence", startMs: 420, endMs: 800 },
                { id: "period", text: ".", startMs: 800, endMs: 850 },
                { id: "second", text: "Second", startMs: 1100, endMs: 1500 },
                { id: "sentence-b", text: "sentence", startMs: 1520, endMs: 1950 },
                { id: "question", text: "?", startMs: 1950, endMs: 2000 },
              ],
            },
          },
        }}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    const paragraphs = Array.from(
      container.querySelectorAll("[data-transcript-paragraph]"),
    );
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual([
      "First sentence.",
      "Second sentence?",
    ]);
  });

  it("adapts guide and selection actions to the narrow editor panel container", async () => {
    const { TranscriptEditor } = await import("../index");
    const { container } = render(
      <EditorProvider
        initialState={{
          fps: 30,
          tracks: [{
            id: "dialogue",
            name: "Dialogue",
            items: [{
              id: "clip",
              type: "video",
              assetId: "speech",
              src: "speech.mp4",
              from: 0,
              durationInFrames: 60,
            }],
          }],
          assetTranscripts: {
            speech: {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "speech",
              text: "Keep this",
              durationMs: 1200,
              words: [
                { id: "keep", text: "Keep", startMs: 0, endMs: 500 },
                { id: "this", text: "this", startMs: 520, endMs: 1000 },
              ],
            },
          },
        }}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    const editor = screen.getByTestId("timeline-transcript-editor");
    expect(editor.style.containerType).toBe("inline-size");
    expect(editor.style.containerName).toBe("transcript-editor");
    expect(
      container.querySelector("style[data-transcript-responsive-styles]")?.textContent,
    ).toContain("@container transcript-editor (max-width: 300px)");

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(
      screen.getByRole("button", { name: "Delete selected transcript words" }).closest("footer")?.getAttribute("data-transcript-selection-footer"),
    ).toBe("");
  });

  it("edits only the primary video transcript when overlay audio overlaps it", async () => {
    const { TranscriptEditor } = await import("../index");

    render(
      <EditorProvider
        initialState={{
          fps: 30,
          primaryTrackId: "story",
          tracks: [
            {
              id: "overlay",
              name: "Second microphone",
              items: [
                {
                  id: "overlay-clip",
                  type: "audio",
                  assetId: "overlay-asset",
                  src: "overlay.wav",
                  from: 0,
                  durationInFrames: 60,
                },
              ],
            },
            {
              id: "story",
              name: "Main dialogue",
              items: [
                {
                  id: "story-clip",
                  type: "video",
                  assetId: "story-asset",
                  src: "story.mp4",
                  from: 0,
                  durationInFrames: 60,
                },
              ],
            },
          ],
          assetTranscripts: {
            "overlay-asset": {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "overlay-asset",
              text: "重复收音",
              durationMs: 1000,
              words: [{ id: "o1", text: "重复收音", startMs: 0, endMs: 1000 }],
            },
            "story-asset": {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "story-asset",
              text: "主轨对白",
              durationMs: 1000,
              words: [{ id: "s1", text: "主轨对白", startMs: 0, endMs: 1000 }],
            },
          },
        }}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    expect(screen.getByRole("button", { name: "主轨对白" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重复收音" })).toBeNull();
    expect(screen.queryByText(/Main storyline/i)).toBeNull();
  });

  it("deletes selected words immediately and exposes one-click undo", async () => {
    const ui = (await import("../index")) as Record<string, any>;
    expect(typeof ui.TranscriptEditor).toBe("function");
    const TranscriptEditor = ui.TranscriptEditor;
    const onStateChange = vi.fn();

    render(
      <EditorProvider
        initialState={{
          fps: 30,
          durationInFrames: 90,
          tracks: [
            {
              id: "dialogue",
              name: "Dialogue",
              items: [
                {
                  id: "clip-a",
                  type: "video",
                  assetId: "asset-a",
                  src: "a.mp4",
                  from: 0,
                  durationInFrames: 90,
                  sourceStartInFrames: 0,
                },
              ],
            },
          ],
          assetTranscripts: {
            "asset-a": {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "asset-a",
              text: "大家 嗯 现在",
              durationMs: 1500,
              words: [
                { id: "w1", text: "大家", startMs: 0, endMs: 500 },
                { id: "w2", text: "嗯", startMs: 500, endMs: 1000 },
                { id: "w3", text: "现在", startMs: 1000, endMs: 1500 },
              ],
            },
          },
        }}
        onStateChange={onStateChange}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "嗯" }));
    expect(
      screen.getByRole("button", {
        name: "Delete selected transcript words",
      }),
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("timeline-transcript-editor"), {
      key: "Backspace",
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "嗯" })).toBeNull(),
    );
    const edited = onStateChange.mock.calls[
      onStateChange.mock.calls.length - 1
    ]?.[0] as EditorState;
    expect(edited.tracks[0].items).toMatchObject([
      { id: "clip-a", from: 0, durationInFrames: 15, sourceStartInFrames: 0 },
      {
        id: "clip-a-ripple-15-30",
        from: 15,
        durationInFrames: 60,
        sourceStartInFrames: 30,
      },
    ]);
    expect(screen.getByText("Cut applied")).toBeTruthy();
    expect(screen.getByText(/Timeline gap closed/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Undo last transcript cut" }),
    );
    expect(screen.getByRole("button", { name: "嗯" })).toBeTruthy();

    fireEvent.keyDown(screen.getByTestId("timeline-transcript-editor"), {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "嗯" })).toBeNull(),
    );
  });

  it("keeps the reload-safe Text lineage editable without retranscribing", async () => {
    const { TranscriptEditor } = await import("../index");

    render(
      <EditorProvider
        initialState={{
          fps: 30,
          durationInFrames: 90,
          primaryTrackId: "visuals",
          tracks: [
            {
              id: "visuals",
              name: "Media",
              role: "b-roll",
              items: [{ id: "picture", type: "video", assetId: "picture", src: "picture.mp4", from: 0, durationInFrames: 90 }],
            },
            {
              id: "voice",
              name: "Voiceover",
              role: "narration",
              items: [{ id: "voice-clip", type: "audio", assetId: "speech", src: "voice.wav", from: 0, durationInFrames: 90 }],
            },
            {
              id: "text",
              name: "Text",
              role: "subtitle",
              items: [{
                id: "captions",
                type: "text",
                text: "hello world",
                color: "#fff",
                from: 0,
                durationInFrames: 30,
                cues: [{
                  id: "cue",
                  text: "hello world",
                  startFrame: 0,
                  durationInFrames: 30,
                  sourceStartFrame: 0,
                  sourceEndFrame: 30,
                  wordIds: ["caption-hello", "caption-world"],
                }],
                wordRefs: [
                  {
                    id: "caption-hello",
                    text: "hello",
                    assetId: "speech",
                    assetWordId: "hello",
                    clipId: "voice-clip",
                    trackId: "voice",
                    sourceStartFrame: 0,
                    sourceEndFrame: 12,
                  },
                  {
                    id: "caption-world",
                    text: "world",
                    assetId: "speech",
                    assetWordId: "world",
                    clipId: "voice-clip",
                    trackId: "voice",
                    sourceStartFrame: 18,
                    sourceEndFrame: 30,
                  },
                ],
                sourceToOutputMap: [{
                  sourceStartFrame: 0,
                  sourceEndFrame: 30,
                  outputStartFrame: 0,
                  outputEndFrame: 30,
                }],
              }],
            },
          ],
          assetTranscripts: {},
        }}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    expect(screen.getByRole("button", { name: "hello" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "world" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Transcribe timeline" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "hello" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Correct selected transcript word" }),
      { target: { value: "Hello" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Correct transcript word" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Hello" })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "world" }));
    fireEvent.keyDown(screen.getByTestId("timeline-transcript-editor"), {
      key: "Backspace",
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "world" })).toBeNull(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Undo last transcript cut" }),
    );
    expect(screen.getByRole("button", { name: "world" })).toBeTruthy();
  });

  it("corrects a selected transcript word without cutting its media range", async () => {
    const { TranscriptEditor } = await import("../index");
    const onStateChange = vi.fn();

    render(
      <EditorProvider
        initialState={{
          fps: 30,
          durationInFrames: 60,
          tracks: [
            {
              id: "dialogue",
              name: "Dialogue",
              items: [
                {
                  id: "clip",
                  type: "video",
                  assetId: "speech",
                  src: "speech.mp4",
                  from: 0,
                  durationInFrames: 60,
                },
              ],
            },
          ],
          assetTranscripts: {
            speech: {
              schemaVersion: 1,
              kind: "clash.editor.asset-transcript",
              assetId: "speech",
              text: "Closh editor",
              durationMs: 1200,
              words: [
                { id: "brand", text: "Closh", startMs: 0, endMs: 500 },
                { id: "noun", text: "editor", startMs: 520, endMs: 1000 },
              ],
            },
          },
        }}
        onStateChange={onStateChange}
      >
        <TranscriptEditor />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Closh" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Correct selected transcript word" }),
      { target: { value: "Clash" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Correct transcript word" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Clash" })).toBeTruthy());
    const corrected = onStateChange.mock.calls[
      onStateChange.mock.calls.length - 1
    ]?.[0] as EditorState;
    expect(corrected.assetTranscripts.speech.words[0].text).toBe("Clash");
    expect(corrected.assetTranscripts.speech.text).toBe("Clash editor");
    expect(corrected.tracks[0].items).toEqual([
      expect.objectContaining({
        id: "clip",
        from: 0,
        durationInFrames: 60,
      }),
    ]);
  });

  it("guides an empty timeline back to the real Media workspace", async () => {
    const { TranscriptEditor } = await import("../index");
    const onOpenMedia = vi.fn();

    render(
      <EditorProvider>
        <TranscriptEditor onOpenMedia={onOpenMedia} />
      </EditorProvider>,
    );

    expect(screen.getByText("Bring in the conversation.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Media" }));
    expect(onOpenMedia).toHaveBeenCalledTimes(1);
  });
});
