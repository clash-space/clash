import { describe, expect, it } from "vitest";

import type { PublicAssetStorageService } from "./public-asset-storage.js";
import { runProviderReplayTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";
import {
  createVolcengineModelArkCases,
  createVolcengineModelArkReplayCases,
  createVolcengineSeedAudioReplayCases,
  VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH,
  VOLCENGINE_PUBLIC_VIDEO_REPLAY_FIXTURE_PATH,
  VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
} from "./volcengine-provider-e2e-cases.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function recordedReferenceVideoUrl(
  events: Awaited<ReturnType<typeof readJsonlProviderTestRecording>>,
): string {
  const urls = events.flatMap((event): string[] => {
    if (
      event.type !== "request" ||
      !event.request.url.endsWith("/contents/generations/tasks") ||
      !isRecord(event.request.body) ||
      !Array.isArray(event.request.body.content)
    ) {
      return [];
    }
    return event.request.body.content.flatMap((part): string[] => {
      if (!isRecord(part) || part.role !== "reference_video") return [];
      const video = part.video_url;
      return isRecord(video) && typeof video.url === "string"
        ? [video.url]
        : [];
    });
  });
  if (urls.length !== 1 || !urls[0]!.startsWith("https://")) {
    throw new Error(
      `Expected one recorded HTTPS reference video URL, got ${urls.length}.`,
    );
  }
  return urls[0]!;
}

function replayPublicStorage(
  providerUrl: string,
  publishedKeys: string[],
): PublicAssetStorageService {
  return {
    async getPublicConfig() {
      return {
        capability: "public-asset-storage",
        mode: "byos",
        available: true,
        provider: "tos",
        account_id: null,
        endpoint: null,
        bucket: "offline-replay",
        region: "cn-beijing",
        key_prefix: "clash-temporary",
        force_path_style: false,
        has_access_key_id: false,
        has_secret_access_key: false,
        has_session_token: false,
        managed: { available: false, authenticated: false },
      };
    },
    async updateFromRequest() {
      throw new Error("Offline replay does not mutate public storage config.");
    },
    async testConnection() {},
    async publish(input) {
      publishedKeys.push(input.key);
      return {
        key: input.key,
        url: providerUrl,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    },
    async delete() {},
  };
}

describe("Volcengine provider replay", () => {
  it("replays the successful Seedance 2.0 requests in the ModelArk cassette", async () => {
    const cases = await createVolcengineModelArkReplayCases();
    const result = await runProviderReplayTestHarness({
      fixturePath: VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH,
      account: {
        id: "volcengine-modelark-replay",
        providerId: "volcengine",
        upstreamId: "volcengine",
        credentials: { apiKey: "offline-replay-placeholder" },
      },
      cases,
      bundledPluginIds: ["clash.volcengine"],
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual(
      cases.map(({ id }) => ({ id, kind: "video" })),
    );

    const events = await readJsonlProviderTestRecording(
      VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH,
    );
    const responseStatus = new Map(
      events.flatMap((event) =>
        event.type === "response"
          ? [[event.requestId, event.response.status] as const]
          : [],
      ),
    );
    const submissions = events.flatMap(
      (
        event,
      ): Array<{
        requestId: string;
        body: Record<string, unknown>;
      }> => {
        if (
          event.type !== "request" ||
          !event.request.url.endsWith("/contents/generations/tasks") ||
          !isRecord(event.request.body)
        )
          return [];
        return [{ requestId: event.requestId, body: event.request.body }];
      },
    );
    const successfulSubmissions = submissions.filter(
      ({ requestId }) => (responseStatus.get(requestId) ?? 500) < 300,
    );
    expect(successfulSubmissions).toHaveLength(cases.length);
    expect(
      new Set(successfulSubmissions.map(({ body }) => body.model)),
    ).toEqual(new Set(["doubao-seedance-2-0-260128"]));
    expect(
      successfulSubmissions.some(
        ({ body: { content } }) =>
          Array.isArray(content) &&
          content.some(
            (part) => isRecord(part) && part.role === "first_frame",
          ) &&
          content.some((part) => isRecord(part) && part.role === "last_frame"),
      ),
    ).toBe(true);
    expect(
      successfulSubmissions.some(
        ({ body: { content } }) =>
          Array.isArray(content) &&
          content.some(
            (part) => isRecord(part) && part.role === "reference_image",
          ) &&
          content.some(
            (part) => isRecord(part) && part.role === "reference_audio",
          ),
      ),
    ).toBe(true);

    const rejectedSubmissions = submissions.filter(
      ({ requestId }) => (responseStatus.get(requestId) ?? 500) >= 300,
    );
    expect(rejectedSubmissions).toHaveLength(1);
    expect(responseStatus.get(rejectedSubmissions[0]!.requestId)).toBe(400);
    expect(rejectedSubmissions[0]!.body.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "reference_video" }),
      ]),
    );
  }, 180_000);

  it("replays a TOS-published Seedance reference video with provider egress blocked", async () => {
    const events = await readJsonlProviderTestRecording(
      VOLCENGINE_PUBLIC_VIDEO_REPLAY_FIXTURE_PATH,
    );
    const providerUrl = recordedReferenceVideoUrl(events);
    const publishedKeys: string[] = [];
    const cases = (await createVolcengineModelArkCases()).filter(
      ({ id }) => id === "volcengine-seedance-2.5-edit",
    );

    const result = await runProviderReplayTestHarness({
      fixturePath: VOLCENGINE_PUBLIC_VIDEO_REPLAY_FIXTURE_PATH,
      account: {
        id: "volcengine-public-video-replay",
        providerId: "volcengine",
        upstreamId: "volcengine",
        credentials: { apiKey: "offline-replay-placeholder" },
      },
      cases,
      bundledPluginIds: ["clash.volcengine"],
      publicAssetStorage: replayPublicStorage(providerUrl, publishedKeys),
    });

    expect(result.cases).toEqual([
      expect.objectContaining({
        id: "volcengine-seedance-2.5-edit",
        kind: "video",
      }),
    ]);
    expect(publishedKeys).toHaveLength(1);
    expect(providerUrl).not.toMatch(/^data:/);

    const submission = events.find(
      (event) =>
        event.type === "request" &&
        event.request.method === "POST" &&
        event.request.url.endsWith("/contents/generations/tasks"),
    );
    expect(submission?.type).toBe("request");
    if (submission?.type === "request") {
      expect(submission.request.body).toEqual(
        expect.objectContaining({
          model: "doubao-seedance-2-5-260628",
          omni_reference_task_type: "edit",
          output_format: "mp4",
        }),
      );
    }
  }, 180_000);

  it("replays the three recorded text-only Seed Audio requests", async () => {
    const cases = await createVolcengineSeedAudioReplayCases();
    const result = await runProviderReplayTestHarness({
      fixturePath: VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
      account: {
        id: "volcengine-replay",
        providerId: "volcengine-speech",
        upstreamId: "volcengine-speech",
        credentials: { apiKey: "offline-replay-placeholder" },
      },
      cases,
      bundledPluginIds: ["clash.volcengine"],
    });

    expect(
      result.cases
        .map(({ id, kind }) => ({ id, kind }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      cases
        .map(({ id }) => ({ id, kind: "audio" }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );

    const events = await readJsonlProviderTestRecording(
      VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
    );
    const bodies = events.flatMap((event): Record<string, unknown>[] => {
      if (
        event.type !== "request" ||
        !event.request.url.endsWith("/api/v3/tts/create") ||
        !isRecord(event.request.body)
      )
        return [];
      return [event.request.body];
    });
    expect(bodies).toHaveLength(3);
    expect(bodies.every((body) => !("references" in body))).toBe(true);
    expect(bodies.map(({ text_prompt }) => text_prompt)).toEqual(
      cases.map(({ prompt }) => prompt),
    );
  }, 180_000);
});
