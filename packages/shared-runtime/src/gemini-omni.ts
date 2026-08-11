export type GeminiOmniInputPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface GeminiOmniInteraction {
  id?: string;
  name?: string;
  status?: string;
  error?: { message?: string; [key: string]: unknown };
  steps?: unknown[];
  [key: string]: unknown;
}

export interface GeminiOmniVideoOutput {
  mimeType: string;
  data?: string;
  uri?: string;
}

export interface CreateGeminiOmniInteractionInput {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  input: ReadonlyArray<GeminiOmniInputPart>;
  aspectRatio: "16:9" | "9:16";
  duration: number;
  fetch?: typeof fetch;
}

export interface GetGeminiOmniInteractionInput {
  apiKey?: string;
  baseUrl?: string;
  interactionId: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function apiBaseUrl(value?: string): string {
  const baseUrl = trimTrailingSlash(value || DEFAULT_BASE_URL);
  try {
    const url = new URL(baseUrl);
    if (
      url.hostname === "gateway.ai.cloudflare.com"
      && !/\/v\d+(?:beta\d*)?$/.test(url.pathname)
    ) {
      return `${baseUrl}/v1beta`;
    }
  } catch {
    // Let fetch surface malformed custom URLs with its normal error.
  }
  return baseUrl;
}

function interactionPath(value: string): string {
  const trimmed = value.replace(/^\/+/, "");
  return trimmed.startsWith("interactions/") ? trimmed : `interactions/${trimmed}`;
}

async function parseJsonResponse(response: Response, operation: string): Promise<any> {
  const raw = await response.text();
  let json: any;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { error: { message: raw || response.statusText } };
  }
  if (!response.ok) {
    throw new Error(`Gemini Omni ${operation} failed: ${json?.error?.message ?? response.statusText}`);
  }
  return json;
}

function headers(
  input: { apiKey?: string; baseUrl?: string },
  contentType = false,
): Record<string, string> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Gemini Omni requires a Google API key.");
  }
  return {
    "x-goog-api-key": apiKey,
    ...(contentType ? { "content-type": "application/json" } : {}),
  };
}

export async function createGeminiOmniInteraction(
  input: CreateGeminiOmniInteractionInput,
): Promise<GeminiOmniInteraction> {
  const fetchImpl = input.fetch ?? fetch;
  const baseUrl = apiBaseUrl(input.baseUrl);
  const serializedInput = input.input.length === 1 && input.input[0]?.type === "text"
    ? input.input[0].text
    : input.input.map((part) => part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", data: part.data, mime_type: part.mimeType });
  const response = await fetchImpl(`${baseUrl}/interactions`, {
    method: "POST",
    headers: headers(input, true),
    body: JSON.stringify({
      model: input.model,
      input: serializedInput,
      response_format: {
        type: "video",
        aspect_ratio: input.aspectRatio,
        duration: `${input.duration}s`,
        delivery: "uri",
      },
      background: true,
      store: true,
      stream: false,
    }),
  });
  return parseJsonResponse(response, "interaction creation");
}

export async function getGeminiOmniInteraction(
  input: GetGeminiOmniInteractionInput,
): Promise<GeminiOmniInteraction> {
  const fetchImpl = input.fetch ?? fetch;
  const baseUrl = apiBaseUrl(input.baseUrl);
  const response = await fetchImpl(`${baseUrl}/${interactionPath(input.interactionId)}`, {
    method: "GET",
    headers: headers(input),
  });
  return parseJsonResponse(response, "interaction polling");
}

function findVideo(value: unknown): GeminiOmniVideoOutput | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideo(item);
      if (found) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const isVideo = record.type === "video" || (
    typeof record.mime_type === "string" && record.mime_type.startsWith("video/")
  );
  if (isVideo) {
    const data = typeof record.data === "string" ? record.data : undefined;
    const uri = typeof record.uri === "string" ? record.uri : undefined;
    if (data || uri) {
      return {
        ...(data ? { data } : {}),
        ...(uri ? { uri } : {}),
        mimeType: typeof record.mime_type === "string" ? record.mime_type : "video/mp4",
      };
    }
  }

  for (const nested of Object.values(record)) {
    const found = findVideo(nested);
    if (found) return found;
  }
  return undefined;
}

export function extractGeminiOmniVideo(
  interaction: GeminiOmniInteraction,
): GeminiOmniVideoOutput | undefined {
  return findVideo(interaction.steps) ?? findVideo(interaction);
}

export function geminiOmniInteractionId(interaction: GeminiOmniInteraction): string {
  const id = interaction.id ?? interaction.name;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Gemini Omni interaction response did not include an id.");
  }
  return id;
}

export function geminiOmniInteractionStatus(interaction: GeminiOmniInteraction): string {
  return String(interaction.status ?? "").trim().toLowerCase();
}

export async function downloadGeminiOmniVideo(input: {
  apiKey?: string;
  uri: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
}): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const fetchImpl = input.fetch ?? fetch;
  const match = /(?:^|\/)files\/([^/:?#]+)/.exec(input.uri);
  if (match?.[1]) {
    const fileId = match[1];
    let baseUrl = apiBaseUrl(input.baseUrl);
    if (!input.baseUrl) {
      try {
        const uri = new URL(input.uri);
        const filesIndex = uri.pathname.indexOf("/files/");
        if (filesIndex >= 0) baseUrl = `${uri.origin}${uri.pathname.slice(0, filesIndex)}`;
      } catch {
        // Relative files/<id> URIs use the default Gemini base URL.
      }
    }
    const metadataUrl = `${baseUrl}/files/${encodeURIComponent(fileId)}`;
    let active = false;
    for (let attempt = 0; attempt < (input.maxAttempts ?? 120); attempt += 1) {
      const metadataResponse = await fetchImpl(metadataUrl, {
        method: "GET",
        headers: headers(input),
      });
      const metadata = await parseJsonResponse(metadataResponse, "file polling");
      const state = typeof metadata?.state === "string"
        ? metadata.state
        : typeof metadata?.state?.name === "string"
          ? metadata.state.name
          : "";
      if (state.toUpperCase() === "ACTIVE") {
        active = true;
        break;
      }
      if (state.toUpperCase() === "FAILED") {
        throw new Error("Gemini Omni generated video file processing failed.");
      }
      if ((input.pollIntervalMs ?? 5_000) > 0) {
        await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? 5_000));
      }
    }
    if (!active) throw new Error("Gemini Omni generated video file did not become ACTIVE.");
    const response = await fetchImpl(`${metadataUrl}:download?alt=media`, {
      method: "GET",
      headers: headers(input),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Gemini Omni video download failed: ${message || response.statusText}`);
    }
    return {
      bytes: await response.arrayBuffer(),
      mimeType: response.headers.get("content-type")?.split(";")[0] || "video/mp4",
    };
  }

  let downloadHeaders: Record<string, string> = {};
  try {
    const uri = new URL(input.uri);
    if (
      uri.hostname === "gateway.ai.cloudflare.com"
      || uri.hostname === "generativelanguage.googleapis.com"
    ) {
      downloadHeaders = headers(input);
    }
  } catch {
    downloadHeaders = headers(input);
  }
  const response = await fetchImpl(input.uri, { method: "GET", headers: downloadHeaders });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gemini Omni video download failed: ${message || response.statusText}`);
  }
  return {
    bytes: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type")?.split(";")[0] || "video/mp4",
  };
}
