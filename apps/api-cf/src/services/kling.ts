import * as jose from "jose";

const BASE_URL = "https://api-beijing.klingai.com/v1/videos/image2video";

interface KlingConfig {
  accessKey: string;
  secretKey: string;
}

interface KlingGenerateParams {
  image: string;
  prompt?: string;
  duration?: number;
  cfgScale?: number;
  negativePrompt?: string;
  model?: string;
  isBase64?: boolean;
}

interface KlingResult {
  code: number;
  data: {
    task_id: string;
    task_status: string;
    task_result?: {
      videos: Array<{ url: string; duration: number; cover_image_url?: string }>;
    };
  };
}

async function generateJwtToken(config: KlingConfig): Promise<string> {
  const secret = new TextEncoder().encode(config.secretKey);
  const now = Math.floor(Date.now() / 1000);

  return await new jose.SignJWT({
    iss: config.accessKey,
    exp: now + 1800,
    nbf: now - 5,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secret);
}

function stripDataUrl(base64Str: string): string {
  if (base64Str.startsWith("data:")) {
    const idx = base64Str.indexOf(",");
    return idx >= 0 ? base64Str.slice(idx + 1) : base64Str;
  }
  return base64Str;
}

/** Create a video generation task and return the task_id. */
export async function createVideoTask(
  config: KlingConfig,
  params: KlingGenerateParams
): Promise<string> {
  const token = await generateJwtToken(config);

  const image = params.isBase64 ? stripDataUrl(params.image) : params.image;

  const payload: Record<string, unknown> = {
    model_name: params.model ?? "kling-v1",
    image,
    duration: String(params.duration ?? 5),
  };
  if (params.prompt) payload.prompt = params.prompt;
  if (params.negativePrompt) payload.negative_prompt = params.negativePrompt;
  if (params.cfgScale !== undefined && params.cfgScale !== 0.5) {
    payload.cfg_scale = params.cfgScale;
  }

  const resp = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kling API error ${resp.status}: ${text}`);
  }

  const result = (await resp.json()) as KlingResult;
  if (result.code !== 0) {
    throw new Error(`Kling API returned error: ${JSON.stringify(result)}`);
  }

  const taskId = result.data?.task_id;
  if (!taskId) {
    throw new Error(`No task_id returned: ${JSON.stringify(result)}`);
  }

  return taskId;
}

/** Poll a video generation task until completion or timeout. */
export async function pollVideoTask(
  config: KlingConfig,
  taskId: string,
  pollIntervalMs = 5000,
  maxWaitMs = 300_000
): Promise<{ url: string; duration: number; coverImageUrl?: string }> {
  const token = await generateJwtToken(config);
  const queryUrl = `${BASE_URL}/${taskId}`;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const resp = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Kling poll error: ${resp.status}`);

    const result = (await resp.json()) as KlingResult;
    if (result.code !== 0) throw new Error(`Kling query failed: ${JSON.stringify(result)}`);

    const status = result.data?.task_status;
    if (status === "succeed") {
      const videos = result.data.task_result?.videos;
      if (!videos?.length) throw new Error("No videos in completed result");
      return { url: videos[0].url, duration: videos[0].duration, coverImageUrl: videos[0].cover_image_url };
    }
    if (status === "failed") {
      throw new Error(`Video generation failed: ${JSON.stringify(result.data)}`);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Video generation timed out after ${maxWaitMs}ms. Task: ${taskId}`);
}

/** Generate video from image — creates task and polls to completion. */
export async function generateVideo(
  config: KlingConfig,
  params: KlingGenerateParams
): Promise<{ url: string; duration: number; coverImageUrl?: string; taskId: string }> {
  const taskId = await createVideoTask(config, params);
  const result = await pollVideoTask(config, taskId);
  return { ...result, taskId };
}
