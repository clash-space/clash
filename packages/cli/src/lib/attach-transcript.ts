import { createHash } from "node:crypto";

import {
  AsrTimedTranscriptSchema,
  summarizeTranscript,
  transcriptContentHashInput,
  type MediaTranscriptMetadata,
} from "@clash/shared-types";

import { attachAssetMetadata, type AttachAssetMetadataResult } from "./attach-asset-metadata";

/**
 * The word grid's own identity, stable under any restatement of the same words.
 * Downstream cuts and caption cues address words by id, so this is what tells
 * them whether they are still talking about the transcript they were built on.
 */
export function transcriptGridHash(
  transcript: Pick<ReturnType<typeof AsrTimedTranscriptSchema.parse>, "words">,
): string {
  return `sha256:${createHash("sha256")
    .update(transcriptContentHashInput(transcript), "utf8")
    .digest("hex")}`;
}

export type AttachTranscriptOptions = {
  cwd: string;
  assetId: string;
  /** The millisecond word-level document the ASR endpoint returns. */
  transcript: unknown;
  /** Hash of the media that was transcribed. */
  sourceHash: string;
  producer?: string;
  assetsPath?: string;
  dataDir?: string;
};

export type AttachTranscriptResult = AttachAssetMetadataResult & {
  contentHash: string;
  summary: MediaTranscriptMetadata["summary"];
};

/**
 * Attach a transcript to any audio or video asset. Nothing about this is
 * talking-head specific: a transcript is a fact about the media, so it does not
 * need a workflow, a plan file, or a CLI verb of its own.
 */
export async function attachTranscript(
  options: AttachTranscriptOptions,
): Promise<AttachTranscriptResult> {
  const transcript = AsrTimedTranscriptSchema.parse(options.transcript);
  const contentHash = transcriptGridHash(transcript);
  const summary = summarizeTranscript(transcript);

  const attached = await attachAssetMetadata({
    cwd: options.cwd,
    assetId: options.assetId,
    metadataKind: "media.transcript",
    producer: options.producer ?? "clash.local.asr",
    body: transcript,
    ...(options.assetsPath ? { assetsPath: options.assetsPath } : {}),
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    metadata: {
      schemaVersion: 1,
      backendId: transcript.backendId,
      modelId: transcript.modelId,
      ...(transcript.language ? { language: transcript.language } : {}),
      sourceHash: options.sourceHash,
      contentHash,
      summary,
    },
  });

  return { ...attached, contentHash, summary };
}
