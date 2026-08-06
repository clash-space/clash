import { describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";

import {
  DreaminaCliCommandError,
  createDreaminaCliOAuthDriver,
  generateDreaminaCliVideo,
  generateDreaminaCliVideoMedia,
  parseDreaminaOAuthOutput,
} from "./dreamina-cli";

describe("Dreamina CLI adapter", () => {
  it("parses official CLI headless OAuth material", () => {
    expect(parseDreaminaOAuthOutput(`
verification_uri: https://jimeng.jianying.com/device
user_code: ABCD-EFGH
device_code: device-code-1
expires_at: 2026-06-26T03:00:00Z
`)).toEqual({
      verificationUri: "https://jimeng.jianying.com/device",
      userCode: "ABCD-EFGH",
      deviceCode: "device-code-1",
      expiresAt: "2026-06-26T03:00:00Z",
    });
  });

  it("starts and completes OAuth through official CLI commands", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: [
          "verification_uri: https://jimeng.jianying.com/device",
          "user_code: ABCD-EFGH",
          "device_code: device-code-1",
        ].join("\n"),
        stderr: "",
        authState: JSON.stringify({ version: 1, items: [{ service: "dreamina", account: "pending", password: "pkce" }] }),
      })
      .mockResolvedValueOnce({
        stdout: "login success\ncredit: 100",
        stderr: "",
        authState: JSON.stringify({ version: 1, items: [{ service: "dreamina", account: "oauth", password: "secret" }] }),
      });
    const driver = createDreaminaCliOAuthDriver({ run });

    await expect(driver.start()).resolves.toMatchObject({
      verificationUri: "https://jimeng.jianying.com/device",
      userCode: "ABCD-EFGH",
      deviceCode: "device-code-1",
      oauthState: expect.stringContaining('"account":"pending"'),
    });
    await expect(driver.complete({
      deviceCode: "device-code-1",
      oauthState: JSON.stringify({ version: 1, items: [{ service: "dreamina", account: "pending", password: "pkce" }] }),
    })).resolves.toMatchObject({
      accountLabel: "Dreamina CLI",
      accessToken: expect.stringContaining('"version":1'),
      tokenType: "DREAMINA_KEYRING_V1",
    });
    expect(run).toHaveBeenNthCalledWith(1, ["login", "--headless"], expect.objectContaining({
      authState: null,
      captureAuthState: true,
    }));
    expect(run).toHaveBeenNthCalledWith(2, ["login", "checklogin", "--device_code=device-code-1", "--poll=60"], expect.objectContaining({
      authState: expect.stringContaining('"account":"pending"'),
      captureAuthState: true,
    }));
  });

  it("rejects OAuth completion when the self-hosted CLI did not export database auth state", async () => {
    const driver = createDreaminaCliOAuthDriver({
      run: vi.fn(async () => ({ stdout: "login success", stderr: "" })),
    });

    await expect(driver.complete({ deviceCode: "device-code-1" })).rejects.toThrow("database auth state");
  });

  it("preserves authorized OAuth state while surfacing a Dreamina membership entitlement error", async () => {
    const authState = JSON.stringify({ version: 1, items: [{ service: "dreamina", account: "oauth", password: "secret" }] });
    const driver = createDreaminaCliOAuthDriver({
      run: vi.fn(async () => {
        throw new DreaminaCliCommandError("membership required", {
          stdout: "",
          stderr: "登录成功，但当前账号没有 dreamina_cli 使用权限: 仅限高级或高级以上的会员等级",
          authState,
        });
      }),
    });

    await expect(driver.complete({ deviceCode: "device-code-1", oauthState: authState })).resolves.toMatchObject({
      accessToken: authState,
      availabilityError: expect.stringContaining("高级或高级以上"),
    });
  });

  it("submits video generation through the official CLI without private HTTP fallback", async () => {
    const run = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({
        submit_id: "submit-1",
        gen_status: "querying",
      }),
      stderr: "",
    });

    const result = await generateDreaminaCliVideo({
      prompt: "cinematic cat",
      modelName: "seedance-2-text",
      upstreamModel: "seedance2.0fast",
      duration: 5,
      aspectRatio: "16:9",
      run,
    });

    expect(run).toHaveBeenCalledWith([
      "text2video",
      "--prompt=cinematic cat",
      "--model_version=seedance2.0fast",
      "--duration=5",
      "--ratio=16:9",
      "--poll=0",
    ], expect.any(Object));
    expect(result).toEqual({
      taskId: "submit-1",
      status: "querying",
      model: "seedance2.0fast",
    });
  });

  it("submits Seedance 2.5 all-purpose reference with optional references and complete output parameters", async () => {
    const run = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({ submit_id: "submit-25", gen_status: "querying" }),
      stderr: "",
    });

    await generateDreaminaCliVideo({
      prompt: "cinematic cat",
      modelName: "seedance-2.5-ref",
      upstreamModel: "seedance2.5",
      duration: 30,
      aspectRatio: "21:9",
      resolution: "480p",
      run,
    });

    expect(run).toHaveBeenCalledWith([
      "text2video",
      "--prompt=cinematic cat",
      "--model_version=seedance2.5",
      "--duration=30",
      "--ratio=21:9",
      "--video_resolution=480p",
      "--poll=0",
    ], expect.any(Object));
  });

  it("passes local image, video, and audio files to Seedance 2.5 all-purpose reference over stdio", async () => {
    const run = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({ submit_id: "submit-refs" }),
      stderr: "",
    });

    await generateDreaminaCliVideo({
      prompt: "follow the references",
      modelName: "seedance-2.5-ref",
      upstreamModel: "seedance2.5",
      resolution: "720p",
      referenceImagePaths: ["/tmp/one.png", "/tmp/two.png"],
      referenceVideoPaths: ["/tmp/motion.mp4"],
      referenceAudioPaths: ["/tmp/sound.wav"],
      run,
    });

    expect(run).toHaveBeenCalledWith(expect.arrayContaining([
      "multimodal2video",
      "--image=/tmp/one.png",
      "--image=/tmp/two.png",
      "--video=/tmp/motion.mp4",
      "--audio=/tmp/sound.wav",
      "--video_resolution=720p",
    ]), expect.any(Object));
  });

  it("maps the separate Seedance 2.5 first/last-frame card to frames2video", async () => {
    const run = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({ submit_id: "submit-frames" }),
      stderr: "",
    });

    await generateDreaminaCliVideo({
      prompt: "bridge the frames",
      modelName: "seedance-2.5-startend",
      upstreamModel: "seedance2.5",
      resolution: "720p",
      startFramePath: "/tmp/start.png",
      endFramePath: "/tmp/end.png",
      run,
    });

    expect(run).toHaveBeenCalledWith(expect.arrayContaining([
      "frames2video",
      "--first=/tmp/start.png",
      "--last=/tmp/end.png",
      "--video_resolution=720p",
    ]), expect.any(Object));
  });

  it("maps a start frame without an end frame to Dreamina image2video", async () => {
    const run = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({ submit_id: "submit-start" }),
      stderr: "",
    });

    await generateDreaminaCliVideo({
      prompt: "animate the frame",
      modelName: "seedance-2.5-startend",
      upstreamModel: "seedance2.5",
      resolution: "720p",
      startFramePath: "/tmp/start.png",
      run,
    });

    expect(run).toHaveBeenCalledWith(expect.arrayContaining([
      "image2video",
      "--image=/tmp/start.png",
    ]), expect.any(Object));
    expect(run.mock.calls[0]?.[0]).not.toContain("--first=/tmp/start.png");
  });

  it("stages URL references as local files before invoking the Dreamina stdio transport", async () => {
    const calls: string[][] = [];
    const run = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === "query_result") {
        const outputDir = args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
        if (!outputDir) throw new Error("missing output dir");
        await writeFile(`${outputDir}/result.mp4`, "generated-video");
        return { stdout: JSON.stringify({ gen_status: "success" }), stderr: "" };
      }
      return { stdout: JSON.stringify({ submit_id: "submit-staged" }), stderr: "" };
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith(".png")) return new Response("image", { headers: { "content-type": "image/png" } });
      if (value.endsWith(".mp4")) return new Response("video", { headers: { "content-type": "video/mp4" } });
      return new Response("audio", { headers: { "content-type": "audio/wav" } });
    });

    await generateDreaminaCliVideoMedia({
      prompt: "preserve authored order",
      modelName: "seedance-2.5-ref",
      upstreamModel: "seedance2.5",
      resolution: "720p",
      referenceImageUrls: ["https://media.test/look.png"],
      referenceVideoUrls: ["https://media.test/motion.mp4"],
      referenceAudioUrls: ["https://media.test/music.wav"],
      fetch: fetchImpl as typeof fetch,
      pollIntervalMs: 0,
      run,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(calls[0]?.[0]).toBe("multimodal2video");
    expect(calls[0]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^--image=.*\.png$/),
      expect.stringMatching(/^--video=.*\.mp4$/),
      expect.stringMatching(/^--audio=.*\.wav$/),
    ]));
  });
});
