import type { GenerationParams } from "./params";
import type { GenerationProvider } from "./provider";
import { veoProvider } from "./providers/veo";
import { falVideoProvider } from "./providers/fal-video";
import { googleImageProvider } from "./providers/google-image";
import { falImageProvider } from "./providers/fal-image";
import { openaiImageProvider } from "./providers/openai-image";
import { geminiTtsProvider } from "./providers/gemini-tts";
import { minimaxAudioProvider } from "./providers/minimax-audio";
import { elevenLabsTtsProvider } from "./providers/elevenlabs-tts";
import { sunoAudioProvider } from "./providers/suno-audio";
import { klingVideoProvider } from "./providers/kling-video";
import { volcengineVideoProvider } from "./providers/modelark-video";
import { videoRenderProvider } from "./providers/render";
import { customActionProvider } from "./providers/custom-action";
import { textGenProvider } from "./providers/text-gen";
import { googleTextProvider } from "./providers/google-text";
import { understandProvider } from "./providers/understand";
import { describeProvider } from "./providers/describe";

function selectedRoute(params: GenerationParams) {
  if (!params.selectedRoute) {
    throw new Error(`No configured provider route for ${params.modelName ?? params.type}`);
  }
  return params.selectedRoute;
}

function unsupportedRoute(params: GenerationParams): never {
  const route = selectedRoute(params);
  throw new Error(
    `Hosted provider adapter is not implemented for ${route.providerId ?? route.upstreamId}` +
    ` (${route.apiShape}) on ${route.modelCode}`,
  );
}

export function resolveProvider(params: GenerationParams): GenerationProvider {
  switch (params.type) {
    case "video_gen": {
      const route = selectedRoute(params);
      if (route?.upstreamId === "google-agent-platform") return veoProvider;
      if (route?.upstreamId === "kling") return klingVideoProvider;
      if (route?.apiShape === "dreamina-cli") {
        throw new Error("Dreamina CLI generation is only available in the local desktop runtime.");
      }
      if (route?.upstreamId === "volcengine") return volcengineVideoProvider;
      if (route?.apiShape === "fal") return falVideoProvider;
      return unsupportedRoute(params);
    }
    case "image_gen": {
      const route = selectedRoute(params);
      if (route?.upstreamId === "openai") return openaiImageProvider;
      if (route?.upstreamId === "google-agent-platform") return googleImageProvider;
      if (route?.apiShape === "fal") return falImageProvider;
      return unsupportedRoute(params);
    }
    case "audio_gen": {
      const route = selectedRoute(params);
      if (route?.upstreamId === "google-ai-studio") return geminiTtsProvider;
      if (route?.upstreamId === "minimax") return minimaxAudioProvider;
      if (route?.upstreamId === "elevenlabs") return elevenLabsTtsProvider;
      if (route?.upstreamId === "suno") return sunoAudioProvider;
      return unsupportedRoute(params);
    }
    case "video_render":
      return videoRenderProvider;
    case "custom_action":
      return customActionProvider;
    case "text_gen":
      return selectedRoute(params).upstreamId === "google-agent-platform"
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
