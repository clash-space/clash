export interface ModelArkVideoParams {
  baseUrl?: string;
  prompt: string;
  modelName?: string;
  upstreamModel?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  duration?: number | string;
  aspectRatio?: string;
  modelParams?: Record<string, unknown>;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export interface ModelArkVideoResult {
  url: string;
  coverImageUrl?: string;
  duration?: number;
  taskId: string;
  model: string;
}

const DEFAULT_MODELARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const MODELARK_MODEL_MAP: Record<string, string> = {
  "seedance-2-text": "dreamina-seedance-2-0-260128",
  "seedance-2-startend": "dreamina-seedance-2-0-260128",
  "seedance-2-ref": "dreamina-seedance-2-0-260128",
};

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_MODELARK_BASE_URL).replace(/\/$/, "");
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolParam(params: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = params?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function numericDuration(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && value !== "auto") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function mediaContent(type: "image_url" | "video_url" | "audio_url", urls: string[] | undefined): Array<Record<string, unknown>> {
  return (urls ?? [])
    .filter((url) => url.trim())
    .map((url) => ({
      type,
      [type]: { url },
    }));
}

function extractVideoUrl(json: any): string | undefined {
  return (
    json?.output?.video_url ??
    json?.output?.url ??
    json?.output?.videos?.[0]?.url ??
    json?.content?.video_url ??
    json?.result?.video_url
  );
}

async function parseJsonResponse(resp: Response, label: string): Promise<any> {
  const raw = await resp.text();
  let json: any;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { error: { message: raw } };
  }
  if (!resp.ok) {
    const message = json?.error?.message ?? json?.message ?? `${resp.status} ${resp.statusText}`;
    throw new Error(`${label} failed: ${message}`);
  }
  return json;
}

function buildContent(params: ModelArkVideoParams): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (params.prompt.trim()) content.push({ type: "text", text: params.prompt.trim() });
  const imageUrls = [
    ...(params.startFrameUrl ? [params.startFrameUrl] : []),
    ...(params.endFrameUrl ? [params.endFrameUrl] : []),
    ...(params.referenceImageUrls ?? []),
  ];
  content.push(...mediaContent("image_url", imageUrls));
  content.push(...mediaContent("video_url", params.referenceVideoUrls));
  content.push(...mediaContent("audio_url", params.referenceAudioUrls));
  return content;
}

export async function generateModelArkVideo(
  apiKey: string | undefined,
  params: ModelArkVideoParams,
): Promise<ModelArkVideoResult> {
  const key = apiKey?.trim();
  if (!key) throw new Error("ModelArk API key is required for Seedance generation.");
  const model = params.upstreamModel ?? MODELARK_MODEL_MAP[params.modelName ?? "seedance-2-ref"] ?? params.modelName ?? "dreamina-seedance-2-0-260128";
  const endpoint = `${normalizeBaseUrl(params.baseUrl)}/contents/generations/tasks`;
  const content = buildContent(params);
  if (!content.length) throw new Error("Prompt or reference media is required for ModelArk video generation.");

  const body: Record<string, unknown> = {
    model,
    content,
  };
  const duration = numericDuration(params.duration);
  if (duration !== undefined) body.duration = duration;
  if (params.aspectRatio) body.ratio = params.aspectRatio;
  const resolution = stringParam(params.modelParams, "resolution");
  if (resolution) body.resolution = resolution;
  const generateAudio = boolParam(params.modelParams, "generate_audio");
  if (generateAudio !== undefined) body.generate_audio = generateAudio;

  const createResp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const created = await parseJsonResponse(createResp, "ModelArk create video task");
  const taskId = created?.id ?? created?.task_id;
  if (typeof taskId !== "string" || !taskId) throw new Error("ModelArk create task response returned no id.");

  const start = Date.now();
  const pollIntervalMs = params.pollIntervalMs ?? 5000;
  const maxWaitMs = params.maxWaitMs ?? 10 * 60 * 1000;
  while (Date.now() - start <= maxWaitMs) {
    const pollResp = await fetch(`${endpoint}/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });
    const polled = await parseJsonResponse(pollResp, "ModelArk retrieve video task");
    const status = polled?.status ?? polled?.task_status;
    if (status === "succeeded" || status === "success") {
      const url = extractVideoUrl(polled);
      if (!url) throw new Error("ModelArk completed task returned no video URL.");
      return {
        url,
        coverImageUrl: polled?.output?.cover_url ?? polled?.output?.cover_image_url,
        duration: typeof polled?.output?.duration === "number" ? polled.output.duration : undefined,
        taskId,
        model,
      };
    }
    if (status === "failed" || status === "cancelled" || status === "canceled") {
      throw new Error(`ModelArk video generation failed: ${JSON.stringify(polled?.error ?? polled)}`);
    }
    if (pollIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`ModelArk video generation timed out after ${maxWaitMs}ms. Task: ${taskId}`);
}
