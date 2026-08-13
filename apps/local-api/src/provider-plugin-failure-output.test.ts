import { describe, expect, it } from "vitest";

import {
  createMockExternalAigcService,
  ProviderGenerationError,
  type ProviderPluginFailure,
} from "./local-aigc.js";

const binding = {
  pluginId: "clash.minimax",
  version: "0.1.0",
  exportId: "minimax-execute",
  schemaHash: `sha256:${"e".repeat(64)}`,
} as const;

const failure = {
  code: "rate_limited",
  message: "provider rate limit reached",
  retryable: true,
  requestState: "rejected",
  providerCode: "429_RATE_LIMIT",
  details: { resetAfterMs: 12_000 },
} as const satisfies ProviderPluginFailure;

function providerAccounts() {
  return Promise.resolve([
    {
      id: "minimax-primary",
      providerId: "minimax",
      upstreamId: "minimax",
      enabled: true,
      configuredCredentials: ["apiKey"],
      credentials: { apiKey: "not-sent-to-a-vendor" },
      availableOAuth: [],
    },
  ]);
}

describe("provider plugin structured failures", () => {
  it("returns a media failure with its provider and binding without flattening it", async () => {
    const service = createMockExternalAigcService({
      providerAccounts,
      providerPluginExecutor: async () => ({
        status: "failed",
        binding,
        error: failure,
      }),
    });

    const result = await service.generateVideo({
      taskId: "failed-video-task",
      model: "minimax-h3",
      prompt: "Animate this scene.",
    });

    expect(result).toEqual({
      status: "failed",
      error: failure,
      pluginBinding: binding,
      provider: "minimax",
      modelEndpoint: "MiniMax-H3",
    });
    if (result.status !== "failed")
      throw new Error("expected a failed generation");
    expect(result.error).toBe(failure);
  });

  it("throws a typed text generation error that retains the structured failure", async () => {
    const service = createMockExternalAigcService({
      providerAccounts,
      providerPluginExecutor: async () => ({
        status: "failed",
        binding,
        error: failure,
      }),
    });

    const error = await service
      .generateText({
        taskId: "failed-text-task",
        model: "minimax-m3",
        prompt: "Write one sentence.",
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProviderGenerationError);
    expect(error).toMatchObject({
      failure: {
        code: "rate_limited",
        retryable: true,
        requestState: "rejected",
        providerCode: "429_RATE_LIMIT",
      },
    });
    expect((error as ProviderGenerationError).failure).toBe(failure);
  });

  it("refuses an accepted direct text call without polling outside the durable coordinator", async () => {
    let invocations = 0;
    const service = createMockExternalAigcService({
      providerAccounts,
      providerPluginExecutor: async () => {
        invocations += 1;
        return invocations === 1
          ? {
              status: "accepted" as const,
              binding,
              pollState: { taskId: "paid-task" },
              retryAfterMs: 1,
            }
          : {
              status: "completed" as const,
              binding,
              output: { slot: "text", kind: "value" as const, value: "done" },
            };
      },
    });

    await expect(service.generateText({
      taskId: "accepted-text-task",
      model: "minimax-m3",
      prompt: "Write one sentence.",
    })).rejects.toThrow(/accepted.*durable coordinator/i);
    expect(invocations).toBe(1);
  });
});
