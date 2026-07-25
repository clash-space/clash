export const DIRECTOR_MODEL_GENERATION_ENDPOINT = "fal-ai/hunyuan3d-v3/text-to-3d";

export type DirectorModelGenerationQuality = "normal" | "low-poly" | "geometry";

export interface DirectorModelGenerationInput {
  prompt: string;
  quality: DirectorModelGenerationQuality;
  pbr: boolean;
  faceCount?: number;
}

export interface GeneratedDirectorModel {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  requestId: string;
  provider: "fal";
  modelEndpoint: typeof DIRECTOR_MODEL_GENERATION_ENDPOINT;
  remoteUrl: string;
  thumbnailUrl?: string;
}

function normalizedFaceCount(value: number | undefined): number {
  if (value === undefined) return 500_000;
  if (!Number.isFinite(value)) throw new Error("3D model face count must be finite");
  return Math.max(40_000, Math.min(1_500_000, Math.round(value)));
}

export function buildFalDirectorModelInput(
  input: DirectorModelGenerationInput,
): Record<string, unknown> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("3D model prompt is required");
  if (new TextEncoder().encode(prompt).byteLength > 1024) {
    throw new Error("3D model prompt must be at most 1024 UTF-8 bytes");
  }
  const generateType = input.quality === "low-poly"
    ? "LowPoly"
    : input.quality === "geometry"
      ? "Geometry"
      : "Normal";
  return {
    prompt,
    enable_pbr: input.quality === "geometry" ? false : input.pbr,
    face_count: normalizedFaceCount(input.faceCount),
    generate_type: generateType,
    polygon_type: input.quality === "low-poly" ? "quadrilateral" : "triangle",
  };
}

async function jsonResponse(response: Response): Promise<Record<string, any>> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) as Record<string, any> : {};
  } catch {
    return { detail: raw };
  }
}

function responseError(prefix: string, response: Response, json: Record<string, any>): Error {
  return new Error(
    `${prefix}: ${json.detail ?? json.error?.message ?? json.error ?? response.statusText ?? response.status}`,
  );
}

export async function generateFalDirectorModel({
  input,
  apiKey,
  fetch: fetchImpl = fetch,
  queueBaseUrl = "https://queue.fal.run",
  pollIntervalMs = 1000,
  maxPollAttempts = 240,
}: {
  input: DirectorModelGenerationInput;
  apiKey: string;
  fetch?: typeof fetch;
  queueBaseUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}): Promise<GeneratedDirectorModel> {
  if (!apiKey.trim()) throw new Error("A configured fal.ai API key is required for 3D generation");
  const endpoint = DIRECTOR_MODEL_GENERATION_ENDPOINT;
  const baseUrl = queueBaseUrl.replace(/\/+$/, "");
  const authorization = `Key ${apiKey.trim()}`;
  const submittedResponse = await fetchImpl(`${baseUrl}/${endpoint}`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(buildFalDirectorModelInput(input)),
  });
  const submitted = await jsonResponse(submittedResponse);
  if (!submittedResponse.ok) throw responseError("fal 3D model request failed", submittedResponse, submitted);
  const requestId = submitted.request_id ?? submitted.requestId;
  if (typeof requestId !== "string" || !requestId) {
    throw new Error("fal 3D model response returned no request_id");
  }

  let completed = false;
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    const statusResponse = await fetchImpl(
      `${baseUrl}/${endpoint}/requests/${encodeURIComponent(requestId)}/status`,
      { headers: { authorization } },
    );
    const statusJson = await jsonResponse(statusResponse);
    if (!statusResponse.ok) throw responseError("fal 3D model status failed", statusResponse, statusJson);
    const status = statusJson.status;
    if (status === "COMPLETED") {
      completed = true;
      break;
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(`fal 3D model request failed: ${statusJson.error ?? status}`);
    }
    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  if (!completed) throw new Error(`fal 3D model request timed out: ${requestId}`);

  const resultResponse = await fetchImpl(
    `${baseUrl}/${endpoint}/requests/${encodeURIComponent(requestId)}`,
    { headers: { authorization } },
  );
  const resultJson = await jsonResponse(resultResponse);
  if (!resultResponse.ok) throw responseError("fal 3D model result failed", resultResponse, resultJson);
  const result = resultJson.data ?? resultJson;
  const modelFile = result.model_glb ?? result.model_urls?.glb;
  if (!modelFile || typeof modelFile.url !== "string" || !modelFile.url) {
    throw new Error("fal 3D model result returned no GLB URL");
  }
  const modelResponse = await fetchImpl(modelFile.url);
  if (!modelResponse.ok) {
    throw new Error(`fal 3D model download failed: ${modelResponse.status}`);
  }
  const thumbnailUrl = typeof result.thumbnail?.url === "string"
    ? result.thumbnail.url
    : undefined;
  return {
    bytes: new Uint8Array(await modelResponse.arrayBuffer()),
    contentType: modelResponse.headers.get("content-type")
      ?? modelFile.content_type
      ?? "model/gltf-binary",
    fileName: typeof modelFile.file_name === "string" && modelFile.file_name
      ? modelFile.file_name
      : "generated-model.glb",
    requestId,
    provider: "fal",
    modelEndpoint: endpoint,
    remoteUrl: modelFile.url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}
