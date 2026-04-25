import { isGoogleAudioModel, isGoogleImageModel, isGoogleTextModel, isGoogleVideoModel } from "../services/google-gen";
import type { GenerationParams } from "./params";
import type { GenerationProvider } from "./provider";
import { veoProvider } from "./providers/veo";
import { falVideoProvider } from "./providers/fal-video";
import { googleImageProvider } from "./providers/google-image";
import { falImageProvider } from "./providers/fal-image";
import { geminiTtsProvider } from "./providers/gemini-tts";
import { videoRenderProvider } from "./providers/render";
import { customActionProvider } from "./providers/custom-action";
import { textGenProvider } from "./providers/text-gen";
import { googleTextProvider } from "./providers/google-text";
import { understandProvider } from "./providers/understand";
import { describeProvider } from "./providers/describe";

export function resolveProvider(params: GenerationParams): GenerationProvider {
  switch (params.type) {
    case "video_gen": {
      const model = params.videoModel ?? params.modelName;
      return isGoogleVideoModel(model) ? veoProvider : falVideoProvider;
    }
    case "image_gen": {
      return isGoogleImageModel(params.modelName) ? googleImageProvider : falImageProvider;
    }
    case "audio_gen": {
      if (!isGoogleAudioModel(params.modelName ?? "gemini-3.1-flash-tts")) {
        throw new Error(`Unsupported audio model: ${params.modelName}`);
      }
      return geminiTtsProvider;
    }
    case "video_render":
      return videoRenderProvider;
    case "custom_action":
      return customActionProvider;
    case "text_gen":
      return isGoogleTextModel(params.modelName) ? googleTextProvider : textGenProvider;
    case "understand":
      return understandProvider;
    case "image_desc":
    case "video_desc":
      return describeProvider;
    default:
      throw new Error(`Unknown generation type: ${(params as { type: string }).type}`);
  }
}
