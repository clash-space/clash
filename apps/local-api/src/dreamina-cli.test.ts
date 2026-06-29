import { describe, expect, it, vi } from "vitest";

import {
  createDreaminaCliOAuthDriver,
  generateDreaminaCliVideo,
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
      })
      .mockResolvedValueOnce({
        stdout: "login success\ncredit: 100",
        stderr: "",
      });
    const driver = createDreaminaCliOAuthDriver({ run });

    await expect(driver.start()).resolves.toMatchObject({
      verificationUri: "https://jimeng.jianying.com/device",
      userCode: "ABCD-EFGH",
      deviceCode: "device-code-1",
    });
    await expect(driver.complete({ deviceCode: "device-code-1" })).resolves.toMatchObject({
      accountLabel: "Dreamina CLI",
    });
    expect(run).toHaveBeenNthCalledWith(1, ["login", "--headless"], expect.any(Object));
    expect(run).toHaveBeenNthCalledWith(2, ["login", "checklogin", "--device_code=device-code-1", "--poll=60"], expect.any(Object));
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
});
