import {
  ProviderExecutionError,
  type ExecutorContext,
} from "@clash/action-sdk";
import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

type MediaKind = "image" | "video" | "audio";

export interface VolcengineTypedReferences {
  images: string[];
  videos: string[];
  audios: string[];
  startFrame?: string;
  endFrame?: string;
}

function invalidReference(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_request",
    message,
    retryable: false,
    requestState: "rejected",
  });
}

function defaultMediaType(kind: MediaKind): string {
  if (kind === "audio") return "audio/mpeg";
  if (kind === "video") return "video/mp4";
  return "image/png";
}

async function mediaUrl(
  reference: ExecutablePluginInvocation["input"]["references"][number],
  kind: MediaKind,
  context: ExecutorContext,
): Promise<string | undefined> {
  const resolved = await context.reference(reference);
  if (resolved.form === "text") {
    if (reference.slot === "content") return undefined;
    throw invalidReference(
      `Volcengine ${kind} reference resolved to text instead of media.`,
    );
  }
  if (resolved.kind && resolved.kind !== kind) {
    throw invalidReference(
      `Volcengine ${kind} slot resolved to ${resolved.kind} media.`,
    );
  }
  if (resolved.form === "provider-url") return resolved.providerUrl;
  const mediaType = resolved.mediaType ?? defaultMediaType(kind);
  return `data:${mediaType};base64,${Buffer.from(resolved.bytes).toString("base64")}`;
}

/** Resolve every media input through the Host SDK; provider values never carry Asset locations. */
export async function resolveVolcengineTypedReferences(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
): Promise<VolcengineTypedReferences> {
  const result: VolcengineTypedReferences = {
    images: [],
    videos: [],
    audios: [],
  };
  const ordered = invocation.input.references
    .map((reference, position) => ({ reference, position }))
    .sort(
      (left, right) =>
        left.reference.index - right.reference.index ||
        left.position - right.position,
    )
    .map(({ reference }) => reference);

  for (const reference of ordered) {
    let kind: MediaKind | undefined;
    if (reference.slot === "startFrame" || reference.slot === "endFrame") {
      kind = "image";
    } else if (
      reference.slot === "image" ||
      reference.slot === "video" ||
      reference.slot === "audio"
    ) {
      kind = reference.slot;
    } else if (reference.slot === "content" && "asset" in reference) {
      const assetKind = reference.asset.kind;
      if (
        assetKind === "image" ||
        assetKind === "video" ||
        assetKind === "audio"
      ) {
        kind = assetKind;
      }
    } else if (reference.slot === "content") {
      await context.reference(reference);
      continue;
    }
    if (!kind) continue;
    const url = await mediaUrl(reference, kind, context);
    if (!url) continue;
    if (reference.slot === "startFrame") {
      if (result.startFrame) {
        throw invalidReference(
          "Volcengine received more than one startFrame reference.",
        );
      }
      result.startFrame = url;
    } else if (reference.slot === "endFrame") {
      if (result.endFrame) {
        throw invalidReference(
          "Volcengine received more than one endFrame reference.",
        );
      }
      result.endFrame = url;
    } else if (kind === "image") result.images.push(url);
    else if (kind === "video") result.videos.push(url);
    else result.audios.push(url);
  }
  return result;
}
