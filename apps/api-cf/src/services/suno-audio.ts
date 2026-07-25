export interface SunoAudioParams {
  apiKey: string;
  prompt: string;
  model: string;
  callbackUrl: string;
  modelParams?: Record<string, unknown>;
  baseUrl?: string;
  fetch?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
}

export interface SunoAudioResult {
  url: string;
  taskId: string;
  model: string;
  durationMs?: number;
  title?: string;
}

const TERMINAL_FAILURES = new Set([
  "CREATE_TASK_FAILED",
  "GENERATE_AUDIO_FAILED",
  "CALLBACK_EXCEPTION",
  "SENSITIVE_WORD_ERROR",
]);

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanParam(params: Record<string, unknown> | undefined, key: string): boolean {
  return params?.[key] === true;
}

async function jsonResponse(response: Response, operation: string): Promise<any> {
  const raw = await response.text();
  let parsed: any;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { msg: raw };
  }
  if (!response.ok || parsed?.code !== 200) {
    throw new Error(`Suno API ${operation} failed: ${parsed?.msg || response.statusText}`);
  }
  return parsed;
}

export async function generateSunoAudio(params: SunoAudioParams): Promise<SunoAudioResult> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) throw new Error("Suno provider account is missing apiKey.");
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("Prompt is required for Suno generation.");
  const callbackUrl = params.callbackUrl.trim();
  if (!/^https:\/\//.test(callbackUrl)) {
    throw new Error("Suno generation requires a public HTTPS callback URL.");
  }

  const fetchImpl = params.fetch ?? fetch;
  const wait = params.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const baseUrl = (params.baseUrl || "https://api.sunoapi.org").replace(/\/+$/, "");
  const style = stringParam(params.modelParams, "style");
  const title = stringParam(params.modelParams, "title");
  const customMode = !!(style || title);
  if (customMode && (!style || !title)) {
    throw new Error("Suno custom mode requires both style and title.");
  }
  const instrumental = booleanParam(params.modelParams, "instrumental");
  const body = {
    customMode,
    instrumental,
    model: params.model,
    callBackUrl: callbackUrl,
    prompt,
    ...(customMode ? { style, title } : {}),
  };
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  const submitted = await jsonResponse(await fetchImpl(`${baseUrl}/api/v1/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), "submit");
  const taskId = submitted?.data?.taskId;
  if (typeof taskId !== "string" || !taskId) {
    throw new Error("Suno API submit response returned no taskId.");
  }

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const record = await jsonResponse(await fetchImpl(
      `${baseUrl}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { method: "GET", headers: { authorization: `Bearer ${apiKey}` } },
    ), "poll");
    const data = record?.data;
    const status = typeof data?.status === "string" ? data.status : "PENDING";
    if (TERMINAL_FAILURES.has(status)) {
      throw new Error(`Suno API generation failed: ${data?.errorMessage || status}`);
    }
    if (status === "SUCCESS") {
      const song = data?.response?.sunoData?.[0];
      if (typeof song?.audioUrl !== "string" || !song.audioUrl) {
        throw new Error("Suno API completed without an audioUrl.");
      }
      return {
        url: song.audioUrl,
        taskId,
        model: params.model,
        ...(typeof song.duration === "number" ? { durationMs: Math.round(song.duration * 1000) } : {}),
        ...(typeof song.title === "string" && song.title ? { title: song.title } : {}),
      };
    }
    await wait(5000);
  }
  throw new Error(`Suno API generation timed out: ${taskId}`);
}
