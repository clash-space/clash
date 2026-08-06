import type { OrderedPromptContentPart } from "@clash/shared-types";
import { buildMiniMaxH3Content } from "@clash/shared-runtime";

export interface MiniMaxVideoParams {
  apiKey: string;
  model: string;
  prompt: string;
  duration: number;
  resolution: "768P" | "2K";
  ratio: "adaptive" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  startFrame?: string;
  endFrame?: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  orderedContentParts?: OrderedPromptContentPart[];
  baseUrl?: string;
  fetch?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
}

export interface MiniMaxVideoResult {
  taskId: string;
  url: string;
  model: string;
  duration?: number;
  resolution?: string;
  ratio?: string;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || "https://api.minimax.io").replace(/\/+$/, "");
}

async function parseResponse(response: Response, operation: string): Promise<any> {
  const raw = await response.text();
  let json: any;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { message: raw };
  }
  if (!response.ok) {
    throw new Error(`MiniMax H3 ${operation} failed: ${json?.error?.message ?? json?.message ?? response.statusText}`);
  }
  return json;
}

export async function generateMiniMaxVideo(params: MiniMaxVideoParams): Promise<MiniMaxVideoResult> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) throw new Error("MiniMax provider account is missing apiKey.");
  const orderedContentParts = params.orderedContentParts ?? [];
  const orderedPrompt = orderedContentParts
    .filter((part): part is Extract<OrderedPromptContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
  const prompt = (orderedPrompt.trim() ? orderedPrompt : params.prompt).trim();
  if (!prompt) throw new Error("Prompt is required for MiniMax H3 generation.");
  const referenceImages = params.referenceImages ?? [];
  const referenceVideos = params.referenceVideos ?? [];
  const referenceAudios = params.referenceAudios ?? [];
  const orderedMediaTypes = new Set(
    orderedContentParts
      .filter((part) => part.type !== "text")
      .map((part) => part.type),
  );
  if (params.endFrame && !params.startFrame) {
    throw new Error("MiniMax H3 end frame requires a start frame.");
  }
  if (params.startFrame && (
    referenceImages.length || referenceVideos.length || referenceAudios.length || orderedMediaTypes.size
  )) {
    throw new Error("MiniMax H3 start/end frames cannot be mixed with omni references.");
  }
  const hasReferenceAudio = referenceAudios.length > 0 || orderedMediaTypes.has("audio");
  const hasReferenceVisual = referenceImages.length > 0 || referenceVideos.length > 0 ||
    orderedMediaTypes.has("image") || orderedMediaTypes.has("video");
  if (hasReferenceAudio && !hasReferenceVisual) {
    throw new Error("MiniMax H3 reference audio requires at least one reference image or video.");
  }

  const fetchImpl = params.fetch ?? fetch;
  const wait = params.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const content = buildMiniMaxH3Content({
    prompt,
    orderedContentParts,
    startFrame: params.startFrame,
    endFrame: params.endFrame,
    referenceImages,
    referenceVideos,
    referenceAudios,
  });
  const created = await parseResponse(await fetchImpl(`${baseUrl}/v2/video_generation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: params.model,
      content,
      resolution: params.resolution,
      duration: params.duration,
      ratio: params.startFrame ? "adaptive" : params.ratio,
    }),
  }), "submit");
  const taskId = created?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new Error("MiniMax H3 submit response returned no task_id.");
  }

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const json = await parseResponse(await fetchImpl(
      `${baseUrl}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    ), "poll");
    const task = json?.task;
    const status = String(task?.status ?? "queued").toLowerCase();
    if (status === "succeeded") {
      const url = task?.content?.url;
      if (typeof url !== "string" || !url) {
        throw new Error("MiniMax H3 completed without a video URL.");
      }
      return {
        taskId,
        url,
        model: params.model,
        ...(typeof task.duration === "number" ? { duration: task.duration } : {}),
        ...(typeof task.resolution === "string" ? { resolution: task.resolution } : {}),
        ...(typeof task.ratio === "string" ? { ratio: task.ratio } : {}),
      };
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(`MiniMax H3 generation failed: ${task?.error?.message ?? task?.message ?? status}`);
    }
    await wait(5000);
  }
  throw new Error(`MiniMax H3 generation timed out: ${taskId}`);
}
