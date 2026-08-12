import { describe, expect, it } from "vitest";

import {
  createGoogleOmniProviderCases,
  createGoogleProviderCases,
  GOOGLE_OMNI_REPLAY_FIXTURE_PATH,
  GOOGLE_REPLAY_FIXTURE_PATH,
} from "./google-provider-e2e-cases.js";
import { runProviderReplayTestHarness } from "./provider-replay-test-harness.js";

describe("Google provider replay", () => {
  it("grades text, image, TTS, ASR, and Veo through the isolated Project backend", async () => {
    const result = await runProviderReplayTestHarness({
      fixturePath: GOOGLE_REPLAY_FIXTURE_PATH,
      account: {
        id: "google-replay",
        providerId: "official",
        upstreamId: "google-ai-studio",
        region: "global",
        credentials: {
          apiKey: "offline-replay-placeholder",
          service: "agent-platform",
          region: "global",
          projectId: "offline-replay-project",
        },
      },
      cases: await createGoogleProviderCases(),
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "google-text", kind: "text" },
      { id: "google-text-pro", kind: "text" },
      { id: "google-text-flash", kind: "text" },
      { id: "google-text-flash-lite", kind: "text" },
      { id: "google-image", kind: "image" },
      { id: "google-image-pro", kind: "image" },
      { id: "google-image-lite", kind: "image" },
      { id: "google-tts-flash", kind: "audio" },
      { id: "google-tts-pro", kind: "audio" },
      { id: "google-asr", kind: "text" },
      { id: "google-veo-quality-text", kind: "video" },
      { id: "google-veo-fast-reference", kind: "video" },
      { id: "google-veo-quality-startend", kind: "video" },
      { id: "google-veo-fast-startend", kind: "video" },
    ]);
  }, 180_000);

  it("grades Gemini Omni through the Vertex Interactions replay", async () => {
    const result = await runProviderReplayTestHarness({
      fixturePath: GOOGLE_OMNI_REPLAY_FIXTURE_PATH,
      account: {
        id: "google-omni-replay",
        providerId: "official",
        upstreamId: "google-ai-studio",
        region: "global",
        credentials: {
          // The placeholder key selects the declared Google route; the access token and project
          // select Vertex at execution time. Replay never sends either value to the network.
          apiKey: "offline-route-placeholder",
          accessToken: "offline-replay-placeholder",
          projectId: "offline-replay-project",
          service: "agent-platform",
          region: "global",
        },
      },
      cases: createGoogleOmniProviderCases(),
    });
    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "google-omni-video", kind: "video" },
    ]);
  }, 180_000);
});
