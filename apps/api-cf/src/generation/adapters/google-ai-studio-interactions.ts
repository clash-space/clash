import { Buffer } from "node:buffer";

import {
  createGeminiOmniInteraction,
  downloadGeminiOmniVideo,
  extractGeminiOmniVideo,
  geminiOmniInteractionId,
  geminiOmniInteractionStatus,
  getGeminiOmniInteraction,
  type GeminiOmniInputPart,
  type GeminiOmniInteraction,
} from "@clash/shared-runtime";

import { log } from "../../logger";
import type { GenerationContext } from "../context";
import type { GenerationAdapter } from "../adapter";
import { credentialsForRoute } from "./provider-credentials";

const COMPLETED_STATUSES = new Set(["completed", "succeeded", "success"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled", "error", "incomplete"]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function interactionError(interaction: GeminiOmniInteraction): string {
  const message = interaction.error?.message;
  return typeof message === "string" && message.trim() ? message : "unknown interaction failure";
}

async function buildInput(ctx: GenerationContext): Promise<GeminiOmniInputPart[]> {
  const { params } = ctx;
  const result: GeminiOmniInputPart[] = [];
  const mentionedKeys = new Set<string>();

  for (const part of params.promptParts ?? []) {
    if (part.type === "text") {
      if (part.text) result.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type !== "asset_ref" || part.modality !== "image" || !part.r2Key) continue;
    const inline = await ctx.readR2Base64(part.r2Key);
    result.push({ type: "image", data: inline.bytesBase64Encoded, mimeType: inline.mimeType });
    mentionedKeys.add(part.r2Key);
  }

  if (!result.some((part) => part.type === "text") && params.prompt) {
    result.unshift({ type: "text", text: params.prompt });
  }
  for (const key of params.referenceImageR2Keys ?? []) {
    if (mentionedKeys.has(key)) continue;
    const inline = await ctx.readR2Base64(key);
    result.push({ type: "image", data: inline.bytesBase64Encoded, mimeType: inline.mimeType });
  }
  if (!result.length) throw new Error("Gemini Omni requires a prompt or at least one reference image.");
  return result;
}

async function pollInteraction(input: {
  apiKey?: string;
  gatewayToken?: string;
  baseUrl?: string;
  interactionId: string;
  initial: GeminiOmniInteraction;
}): Promise<GeminiOmniInteraction> {
  let interaction = input.initial;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = geminiOmniInteractionStatus(interaction);
    if (COMPLETED_STATUSES.has(status)) return interaction;
    if (FAILED_STATUSES.has(status)) {
      throw new Error(`Gemini Omni interaction ${status}: ${interactionError(interaction)}`);
    }
    if (attempt > 0 || !status) await delay(5_000);
    interaction = await getGeminiOmniInteraction({
      apiKey: input.apiKey,
      gatewayToken: input.gatewayToken,
      baseUrl: input.baseUrl,
      interactionId: input.interactionId,
    });
  }
  throw new Error("Gemini Omni interaction timed out after 10 minutes.");
}

function stringCredential(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCloudflareGateway(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname === "gateway.ai.cloudflare.com";
  } catch {
    return false;
  }
}

async function transportCredentials(
  ctx: GenerationContext,
  route: NonNullable<GenerationContext["params"]["selectedRoute"]>,
): Promise<{ apiKey?: string; gatewayToken?: string; baseUrl?: string }> {
  let stored: Record<string, string> = {};
  let storedError: unknown;
  try {
    // Gateway BYOK may intentionally omit apiKey, so select the account first
    // and enforce the alternative transport credentials below.
    stored = await credentialsForRoute(ctx, { ...route, requiredCredentials: [] });
  } catch (error) {
    storedError = error;
  }

  const baseUrl = stringCredential(stored.baseUrl)
    ?? stringCredential(ctx.env.GOOGLE_AI_STUDIO_BASE_URL);
  const gatewayToken = stringCredential(stored.gatewayToken)
    ?? (isCloudflareGateway(baseUrl) ? stringCredential(ctx.env.CF_AIG_TOKEN) : undefined);
  // When the global authenticated Gateway is available, prefer its stored
  // provider key over forwarding a process-level Google key.
  const apiKey = !gatewayToken
    ? stringCredential(stored.apiKey) ?? stringCredential(ctx.env.GOOGLE_API_KEY)
    : undefined;
  if (!apiKey && !gatewayToken) {
    if (storedError) throw storedError;
    throw new Error(
      "Google AI Studio API key or Cloudflare AI Gateway token is required for Gemini Omni.",
    );
  }
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(gatewayToken ? { gatewayToken } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export const googleAiStudioInteractionsAdapter: GenerationAdapter = {
  name: "gemini-omni",

  async execute(ctx) {
    const { params } = ctx;
    const route = params.selectedRoute;
    if (!route || route.apiShape !== "google-ai-studio-interactions") {
      throw new Error(`Gemini Omni execution requires a selected Interactions route for ${params.modelName ?? "unknown model"}`);
    }
    const credentials = await transportCredentials(ctx, route);

    const submitted = await ctx.step(
      "gemini-omni-submit",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
      async () => {
        const input = await buildInput(ctx);
        const interaction = await createGeminiOmniInteraction({
          apiKey: credentials.apiKey,
          gatewayToken: credentials.gatewayToken,
          baseUrl: credentials.baseUrl,
          model: route.upstreamModel,
          input,
          aspectRatio: params.aspectRatio === "9:16" ? "9:16" : "16:9",
          duration: typeof params.duration === "number"
            ? params.duration
            : typeof params.modelParams?.duration === "number"
              ? params.modelParams.duration
              : 5,
        });
        const id = geminiOmniInteractionId(interaction);
        log.info("Gemini Omni interaction submitted", { ...ctx.tag, id, model: route.upstreamModel });
        return { id, interaction };
      },
    );

    const storageKey = await ctx.step(
      "gemini-omni-poll",
      { retries: { limit: 2, delay: "10 seconds" }, timeout: "12 minutes" },
      async () => {
        const interaction = await pollInteraction({
          apiKey: credentials.apiKey,
          gatewayToken: credentials.gatewayToken,
          baseUrl: credentials.baseUrl,
          interactionId: submitted.id,
          initial: submitted.interaction,
        });
        const output = extractGeminiOmniVideo(interaction);
        if (!output) throw new Error("Gemini Omni completed without a video output.");
        if (output.data) {
          return ctx.uploadBytes(new Uint8Array(Buffer.from(output.data, "base64")), output.mimeType);
        }
        if (!output.uri) throw new Error("Gemini Omni video output did not include data or a URI.");
        const downloaded = await downloadGeminiOmniVideo({
          apiKey: credentials.apiKey,
          gatewayToken: credentials.gatewayToken,
          baseUrl: credentials.baseUrl,
          uri: output.uri,
        });
        return ctx.uploadBytes(downloaded.bytes, downloaded.mimeType || output.mimeType);
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey),
    );
    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () => ctx.createAsset({
        kind: "video",
        srcR2Key: storageKey,
        coverR2Key: probe.coverR2Key,
        metadata: probe.metadata,
        sourceModel: params.modelName,
        sourcePrompt: params.prompt,
      }),
    );
    await ctx.notifyCompleted({ assetId });
  },
};
