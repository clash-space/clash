export interface OpenAIInlineImage {
  data: Uint8Array;
  mimeType: string;
  filename?: string;
}

export interface OpenAIImageParams {
  apiKey?: string;
  baseUrl?: string;
  prompt: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
  referenceImages?: OpenAIInlineImage[];
}

export interface OpenAIImageResult {
  data: Uint8Array;
  mediaType: string;
  model: string;
}

const DEFAULT_OPENAI_IMAGES_BASE_URL = "https://api.openai.com/v1";

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_OPENAI_IMAGES_BASE_URL).replace(/\/$/, "");
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberParam(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = params?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function outputFormat(params: Record<string, unknown> | undefined): "png" | "jpeg" | "webp" {
  const value = stringParam(params, "output_format");
  return value === "jpeg" || value === "webp" ? value : "png";
}

function mediaTypeForFormat(format: "png" | "jpeg" | "webp"): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function appendOptionalJson(body: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value) body[key] = value;
}

function appendOptionalForm(form: FormData, key: string, value: string | undefined): void {
  if (value) form.append(key, value);
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extForMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

async function parseImageResponse(resp: Response, model: string, mediaType: string): Promise<OpenAIImageResult> {
  const raw = await resp.text();
  let json: any;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { error: { message: raw } };
  }
  if (!resp.ok) {
    const message = json?.error?.message ?? `${resp.status} ${resp.statusText}`;
    throw new Error(`OpenAI image request failed: ${message}`);
  }

  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) {
    throw new Error(`OpenAI image response returned no b64_json for ${model}.`);
  }

  return {
    data: base64ToBytes(b64),
    mediaType,
    model,
  };
}

async function generateImage(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  modelParams?: Record<string, unknown>;
}): Promise<OpenAIImageResult> {
  const format = outputFormat(input.modelParams);
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
  };
  appendOptionalJson(body, "size", stringParam(input.modelParams, "size"));
  appendOptionalJson(body, "quality", stringParam(input.modelParams, "quality"));
  appendOptionalJson(body, "output_format", format);
  appendOptionalJson(body, "background", stringParam(input.modelParams, "background"));
  appendOptionalJson(body, "moderation", stringParam(input.modelParams, "moderation"));
  body.n = Math.max(1, Math.min(10, numberParam(input.modelParams, "count", 1)));

  const resp = await fetch(`${input.endpoint}/images/generations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseImageResponse(resp, input.model, mediaTypeForFormat(format));
}

async function editImage(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  modelParams?: Record<string, unknown>;
  referenceImages: OpenAIInlineImage[];
}): Promise<OpenAIImageResult> {
  const format = outputFormat(input.modelParams);
  const form = new FormData();
  form.append("model", input.model);
  form.append("prompt", input.prompt);
  appendOptionalForm(form, "size", stringParam(input.modelParams, "size"));
  appendOptionalForm(form, "quality", stringParam(input.modelParams, "quality"));
  appendOptionalForm(form, "output_format", format);
  appendOptionalForm(form, "background", stringParam(input.modelParams, "background"));
  appendOptionalForm(form, "moderation", stringParam(input.modelParams, "moderation"));
  form.append("n", String(Math.max(1, Math.min(10, numberParam(input.modelParams, "count", 1)))));

  input.referenceImages.forEach((image, index) => {
    const filename = image.filename ?? `reference-${index + 1}.${extForMime(image.mimeType)}`;
    form.append("image", new Blob([image.data], { type: image.mimeType }), filename);
  });

  const resp = await fetch(`${input.endpoint}/images/edits`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
    },
    body: form,
  });
  return parseImageResponse(resp, input.model, mediaTypeForFormat(format));
}

export async function generateOpenAIImage(params: OpenAIImageParams): Promise<OpenAIImageResult> {
  const apiKey = params.apiKey?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for GPT Image generation.");

  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("Prompt is required for GPT Image generation.");

  const model = params.modelName?.trim() || "gpt-image-2";
  const endpoint = normalizeBaseUrl(params.baseUrl);
  const refs = params.referenceImages?.filter((image) => image.data.byteLength > 0) ?? [];

  if (refs.length) {
    return editImage({
      endpoint,
      apiKey,
      model,
      prompt,
      modelParams: params.modelParams,
      referenceImages: refs,
    });
  }

  return generateImage({
    endpoint,
    apiKey,
    model,
    prompt,
    modelParams: params.modelParams,
  });
}
