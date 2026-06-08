import { resolveModelUpstreamRoute, type ModelKind, type UpstreamAvailability } from "@clash/shared-types";

import type { GenerationParams } from "./params";
import type { GenerationProvider } from "./provider";
import { veoProvider } from "./providers/veo";
import { falVideoProvider } from "./providers/fal-video";
import { googleImageProvider } from "./providers/google-image";
import { falImageProvider } from "./providers/fal-image";
import { openaiImageProvider } from "./providers/openai-image";
import { geminiTtsProvider } from "./providers/gemini-tts";
import { videoRenderProvider } from "./providers/render";
import { customActionProvider } from "./providers/custom-action";
import { textGenProvider } from "./providers/text-gen";
import { googleTextProvider } from "./providers/google-text";
import { understandProvider } from "./providers/understand";
import { describeProvider } from "./providers/describe";

const HOSTED_UPSTREAM_AVAILABILITY: UpstreamAvailability[] = [
  { upstreamId: "google", enabled: true },
  { upstreamId: "fal", enabled: true },
  { upstreamId: "openai", enabled: true },
];

function resolveRoute(kind: ModelKind, modelCode: string | undefined) {
  if (!modelCode) return null;
  return resolveModelUpstreamRoute({
    modelCode,
    kind,
    configuredUpstreams: HOSTED_UPSTREAM_AVAILABILITY,
  });
}

export function resolveProvider(params: GenerationParams): GenerationProvider {
  switch (params.type) {
    case "video_gen": {
      const model = params.videoModel ?? params.modelName;
      const route = resolveRoute("video", model);
      return route?.upstreamId === "google" ? veoProvider : falVideoProvider;
    }
    case "image_gen": {
      const route = resolveRoute("image", params.modelName);
      if (route?.upstreamId === "openai") return openaiImageProvider;
      return route?.upstreamId === "google" ? googleImageProvider : falImageProvider;
    }
    case "audio_gen": {
      const model = params.modelName ?? "gemini-3.1-flash-tts";
      const route = resolveRoute("audio", model);
      if (route?.upstreamId !== "google") {
        throw new Error(`Unsupported audio model: ${params.modelName}`);
      }
      return geminiTtsProvider;
    }
    case "video_render":
      return videoRenderProvider;
    case "custom_action":
      return customActionProvider;
    case "text_gen":
      return resolveRoute("text", params.modelName)?.upstreamId === "google"
        ? googleTextProvider
        : textGenProvider;
    case "understand":
      return understandProvider;
    case "image_desc":
    case "video_desc":
      return describeProvider;
    default:
      throw new Error(`Unknown generation type: ${(params as { type: string }).type}`);
  }
}
