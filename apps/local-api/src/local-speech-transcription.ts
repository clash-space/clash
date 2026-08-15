import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  AsrTimedTranscriptSchema,
  ExecutableSpeechTranscriptionResultSchema,
  MODEL_CARDS,
  type AssetKind,
  type ExecutablePluginJsonValue,
  type ExecutableSpeechTranscriptionReference,
  type ExecutableSpeechTranscriptionResult,
} from "@clash/shared-types";

import type { LocalAudioConfigStore } from "./audio-config.js";

export interface LocalSpeechTranscriptionRequest {
  projectId: string;
  invocationId: string;
  taskId: string;
  reference: ExecutableSpeechTranscriptionReference;
  modelId: string;
  language?: string;
  poll?: ExecutablePluginJsonValue;
}

export interface LocalSpeechTranscriptionSource {
  kind: AssetKind;
  path: string;
  contentType?: string;
}

function runtimeModelForCanonicalAsrCard(modelId: string): string {
  const card = MODEL_CARDS.find((candidate) => candidate.id === modelId);
  const runtimeModel = card?.defaultParams.asr_model;
  if (
    !card?.input.inputMode.audios ||
    typeof runtimeModel !== "string" ||
    !runtimeModel.trim()
  ) {
    throw new Error(`${modelId} is not a declared local ASR model.`);
  }
  return runtimeModel.trim();
}

/**
 * Host implementation of the narrow `speech.transcribe` capability reserved
 * for the trusted first-party ASR plugin. The plugin sees neither local paths
 * nor runtime model identifiers; its semantic request keeps the canonical
 * model-card id while this adapter maps it at the execution boundary.
 */
export function createLocalSpeechTranscriptionService(options: {
  audioConfig: Pick<LocalAudioConfigStore, "transcribe">;
  openAsset: (input: {
    projectId: string;
    projectAssetId: string;
  }) => Promise<LocalSpeechTranscriptionSource>;
}): (
  input: LocalSpeechTranscriptionRequest,
) => Promise<ExecutableSpeechTranscriptionResult> {
  return async (input) => {
    if (input.poll !== undefined) {
      throw new Error(
        "The Local ASR runtime completes synchronously and does not issue poll state.",
      );
    }
    const runtimeModel = runtimeModelForCanonicalAsrCard(input.modelId);
    const source = await options.openAsset({
      projectId: input.projectId,
      projectAssetId: input.reference.asset.assetId,
    });
    if (
      (source.kind !== "audio" && source.kind !== "video") ||
      source.kind !== input.reference.asset.kind
    ) {
      throw new Error(
        `Project Asset ${input.reference.asset.assetId} is not an audio or video Asset matching the frozen reference.`,
      );
    }
    const bytes = await readFile(source.path);
    const transcript = await options.audioConfig.transcribe({
      file: new File([bytes], basename(source.path), {
        type:
          source.contentType ??
          input.reference.asset.mediaType ??
          "application/octet-stream",
      }),
      ...(input.language === undefined ? {} : { language: input.language }),
      model: runtimeModel,
    });
    return ExecutableSpeechTranscriptionResultSchema.parse({
      status: "completed",
      transcript: AsrTimedTranscriptSchema.parse({
        ...transcript,
        modelId: input.modelId,
      }),
    });
  };
}
