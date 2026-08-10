/**
 * Gemini Omni's interaction API, as two translations.
 *
 * Google takes a video job as an "interaction", names it, and answers questions about that name.
 * Nothing here waits: `geminiSubmit` sends the work and reports what Google called it, `geminiPoll`
 * asks once and reports what Google said. The host decides how often to ask and for how long.
 *
 * That decision used to live in this code as 120 attempts five seconds apart, ending in a thrown
 * "timed out after 10 minutes". The ceiling was not derived from anything, and it sat beside six
 * other loops with six other ceilings.
 *
 * Gemini makes the point twice over, because it has two sequential waits. The interaction has to
 * finish rendering, and then the rendered file has to become downloadable through the Files API.
 * The old code slept through the second one inside its download helper — another 120 attempts that
 * nothing accounted for, stacked on top of the first. Here each is a phase of the poll state, so
 * both are the host's to schedule.
 */

/** Where a submitted job has got to. The host stores this and hands it back; it reads none of it. */
export type GeminiPollState =
  | { phase: "interaction"; interactionId: string }
  | {
      phase: "file";
      interactionId: string;
      fileId: string;
      /** Files live beside the interaction, but not always on the configured base URL. */
      filesBaseUrl: string;
      mimeType: string;
    };

export type GeminiMedia =
  | {
      kind: "url";
      url: string;
      mimeType: string;
      /**
       * Files API downloads are authenticated with the same credential as the interaction, so this
       * URL is not something an anonymous fetch can follow. Stated rather than implied, because a
       * caller that treats every URL as public gets an opaque 403 well after the work succeeded.
       */
      requiresProviderAuth?: boolean;
    }
  | { kind: "inline"; dataBase64: string; mimeType: string };

export interface GeminiOmniTextPart {
  type: "text";
  text: string;
}

export interface GeminiOmniImagePart {
  type: "image";
  data: string;
  mimeType: string;
}

export type GeminiOmniInputPart = GeminiOmniTextPart | GeminiOmniImagePart;

interface GeminiAuth {
  apiKey?: string;
  gatewayToken?: string;
  baseUrl?: string;
}

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Status values that mean the render finished. Three model families, three spellings. */
const SUCCESS_STATUSES = ["completed", "succeeded", "success"];

/**
 * Status values that mean the render stopped for good.
 *
 * `incomplete` reads like a stage on the way to done and is not: Google returns it when a render
 * halts early, typically a safety refusal. Treating it as progress spends the entire poll budget on
 * an interaction that will never move.
 */
const TERMINAL_STATUSES = ["failed", "cancelled", "canceled", "error", "incomplete"];

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function apiBaseUrl(value?: string): string {
  const baseUrl = trimTrailingSlash(value || DEFAULT_BASE_URL);
  try {
    const url = new URL(baseUrl);
    // A Cloudflare gateway URL addresses the provider, not the API version, so the version has to be
    // appended or every path lands one level too high.
    if (url.hostname === "gateway.ai.cloudflare.com" && !/\/v\d+(?:beta\d*)?$/.test(url.pathname)) {
      return `${baseUrl}/v1beta`;
    }
  } catch {
    // Let fetch surface a malformed custom URL with its normal error.
  }
  return baseUrl;
}

function interactionPath(value: string): string {
  const trimmed = value.replace(/^\/+/, "");
  return trimmed.startsWith("interactions/") ? trimmed : `interactions/${trimmed}`;
}

function headers(auth: GeminiAuth, contentType = false): Record<string, string> {
  const apiKey = auth.apiKey?.trim();
  const gatewayToken = auth.gatewayToken?.trim();
  if (apiKey && gatewayToken) {
    throw new Error("Choose either Google API key or Cloudflare AI Gateway token for Gemini Omni.");
  }
  if (gatewayToken) {
    // The token is a bearer credential for Cloudflare specifically. Sending it to whatever base URL
    // is configured would hand it to that host, so the destination is checked before the request is
    // built rather than after it has already left.
    let validGatewayBaseUrl = false;
    try {
      const url = new URL(auth.baseUrl ?? "");
      validGatewayBaseUrl = url.hostname === "gateway.ai.cloudflare.com"
        && /\/google-ai-studio(?:\/v\d+(?:beta\d*)?)?\/?$/.test(url.pathname);
    } catch {
      validGatewayBaseUrl = false;
    }
    if (!validGatewayBaseUrl) {
      throw new Error(
        "Cloudflare AI Gateway token requires a Cloudflare Google AI Studio Gateway base URL.",
      );
    }
  }
  if (!apiKey && !gatewayToken) {
    throw new Error("Gemini Omni requires a Google API key or Cloudflare AI Gateway token.");
  }
  return {
    ...(apiKey ? { "x-goog-api-key": apiKey } : {}),
    ...(gatewayToken ? {
      "cf-aig-authorization": `Bearer ${gatewayToken}`,
      "cf-aig-skip-cache": "true",
    } : {}),
    ...(contentType ? { "content-type": "application/json" } : {}),
  };
}

/**
 * Reads a Gemini response body.
 *
 * Parsed from text rather than a JSON helper because Google answers some failures with an empty
 * body and others with plain prose; both would throw inside a parser and lose the status line that
 * explains what happened.
 */
async function readBody(
  response: Awaited<ReturnType<FetchLike>>,
  operation: string,
): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let json: Record<string, unknown>;
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    json = { error: { message: raw || response.statusText } };
  }
  if (!response.ok) {
    const error = json.error as { message?: unknown } | undefined;
    throw new Error(`Gemini Omni ${operation} failed: ${String(error?.message ?? response.statusText)}`);
  }
  return json;
}

function interactionStatus(interaction: Record<string, unknown>): string {
  return String(interaction.status ?? "").trim().toLowerCase();
}

function interactionId(interaction: Record<string, unknown>): string {
  const id = interaction.id ?? interaction.name;
  if (typeof id !== "string" || !id.trim()) {
    // Some model families name the interaction `id` and others `name`. Without either there is
    // nothing to poll, and the render is running and billable regardless.
    throw new Error("Gemini Omni interaction response did not include an id.");
  }
  return id;
}

function failureMessage(interaction: Record<string, unknown>, status: string): string {
  const error = interaction.error as { message?: unknown } | undefined;
  return `Gemini Omni interaction ${status}: ${String(error?.message ?? "unknown failure")}`;
}

interface FoundVideo {
  mimeType: string;
  data?: string;
  uri?: string;
}

/**
 * Walks the payload for the video output.
 *
 * The output has been seen under `steps` and under keys that vary by model family, so this searches
 * rather than trusting a path. A video is recognised either by an explicit type or by a video mime
 * type, because both spellings occur.
 */
function findVideo(value: unknown): FoundVideo | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideo(item);
      if (found) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const isVideo = record.type === "video"
    || (typeof record.mime_type === "string" && record.mime_type.startsWith("video/"));
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

export async function geminiSubmit(options: {
  apiKey?: string;
  gatewayToken?: string;
  baseUrl?: string;
  model: string;
  input: ReadonlyArray<GeminiOmniInputPart>;
  aspectRatio: "16:9" | "9:16";
  duration: number;
  fetch: FetchLike;
}): Promise<{ pollState: Extract<GeminiPollState, { phase: "interaction" }> }> {
  const auth: GeminiAuth = {
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.gatewayToken === undefined ? {} : { gatewayToken: options.gatewayToken }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
  };
  const baseUrl = apiBaseUrl(options.baseUrl);

  // A lone text part is sent as a bare string; anything else as parts. Google rejects the wrapped
  // form for single-text input on some model families.
  const serializedInput = options.input.length === 1 && options.input[0]?.type === "text"
    ? options.input[0].text
    : options.input.map((part) => part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", data: part.data, mime_type: part.mimeType });

  const response = await options.fetch(`${baseUrl}/interactions`, {
    method: "POST",
    headers: headers(auth, true),
    body: JSON.stringify({
      model: options.model,
      input: serializedInput,
      response_format: {
        type: "video",
        aspect_ratio: options.aspectRatio,
        duration: `${options.duration}s`,
        delivery: "uri",
      },
      background: true,
      store: true,
      stream: false,
    }),
  });
  const interaction = await readBody(response, "interaction creation");
  const id = interactionId(interaction);

  const status = interactionStatus(interaction);
  if (TERMINAL_STATUSES.includes(status)) {
    // A create call can come back already dead. Reporting it as accepted would spend the host's
    // whole poll budget re-reading a failure that was known here.
    throw new Error(failureMessage(interaction, status));
  }

  return { pollState: { phase: "interaction", interactionId: id } };
}

export type GeminiPollResult =
  | { status: "accepted"; pollState: GeminiPollState }
  | { status: "completed"; media: GeminiMedia; interactionId: string };

export async function geminiPoll(options: {
  state: GeminiPollState;
  apiKey?: string;
  gatewayToken?: string;
  baseUrl?: string;
  fetch: FetchLike;
}): Promise<GeminiPollResult> {
  const auth: GeminiAuth = {
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.gatewayToken === undefined ? {} : { gatewayToken: options.gatewayToken }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
  };

  if (options.state.phase === "file") {
    return pollFile(options.state, auth, options.fetch);
  }

  const baseUrl = apiBaseUrl(options.baseUrl);
  const { interactionId: id } = options.state;
  const interaction = await readBody(
    await options.fetch(`${baseUrl}/${interactionPath(id)}`, {
      method: "GET",
      headers: headers(auth),
    }),
    "interaction polling",
  );

  const status = interactionStatus(interaction);
  if (TERMINAL_STATUSES.includes(status)) {
    throw new Error(failureMessage(interaction, status));
  }
  if (!SUCCESS_STATUSES.includes(status)) {
    // Unchanged state: Google keeps naming the interaction the same way for as long as it exists.
    return { status: "accepted", pollState: options.state };
  }

  const output = findVideo(interaction.steps) ?? findVideo(interaction);
  if (!output) throw new Error("Gemini Omni completed without a video output.");
  if (output.data) {
    return {
      status: "completed",
      media: { kind: "inline", dataBase64: output.data, mimeType: output.mimeType },
      interactionId: id,
    };
  }
  if (!output.uri) throw new Error("Gemini Omni video output did not include data or a URI.");

  const file = filesReference(output.uri, options.baseUrl);
  if (!file) {
    // A direct link needs no second wait, and carries no credential requirement of its own.
    return {
      status: "completed",
      media: { kind: "url", url: output.uri, mimeType: output.mimeType },
      interactionId: id,
    };
  }

  // The render finishing and the file being downloadable are two different events. Checking now
  // costs one request and often settles it; when it does not, the wait belongs to the host.
  return pollFile(
    {
      phase: "file",
      interactionId: id,
      fileId: file.fileId,
      filesBaseUrl: file.filesBaseUrl,
      mimeType: output.mimeType,
    },
    auth,
    options.fetch,
  );
}

/**
 * Locates the Files API entry behind a delivered URI.
 *
 * Returns nothing for a plain download link, which is the signal that no second wait applies. When
 * no base URL was configured the file's own origin is used, because a Files URI can point at a host
 * other than the one the interaction was created on.
 */
function filesReference(
  uri: string,
  configuredBaseUrl: string | undefined,
): { fileId: string; filesBaseUrl: string } | undefined {
  const match = /(?:^|\/)files\/([^/:?#]+)/.exec(uri);
  const fileId = match?.[1];
  if (!fileId) return undefined;

  let filesBaseUrl = apiBaseUrl(configuredBaseUrl);
  if (!configuredBaseUrl) {
    try {
      const parsed = new URL(uri);
      const filesIndex = parsed.pathname.indexOf("/files/");
      if (filesIndex >= 0) filesBaseUrl = `${parsed.origin}${parsed.pathname.slice(0, filesIndex)}`;
    } catch {
      // A relative `files/<id>` URI belongs to the default base URL.
    }
  }
  return { fileId, filesBaseUrl };
}

async function pollFile(
  state: Extract<GeminiPollState, { phase: "file" }>,
  auth: GeminiAuth,
  fetchImpl: FetchLike,
): Promise<GeminiPollResult> {
  const metadataUrl = `${state.filesBaseUrl}/files/${encodeURIComponent(state.fileId)}`;
  const metadata = await readBody(
    await fetchImpl(metadataUrl, { method: "GET", headers: headers(auth) }),
    "file polling",
  );

  // The Files API answers with a bare string on one path and a `{ name }` object on another.
  const rawState = metadata.state;
  const nested = rawState && typeof rawState === "object"
    ? (rawState as { name?: unknown }).name
    : undefined;
  const fileState = String(
    typeof rawState === "string" ? rawState : typeof nested === "string" ? nested : "",
  ).toUpperCase();

  if (fileState === "FAILED") {
    throw new Error("Gemini Omni generated video file processing failed.");
  }
  if (fileState !== "ACTIVE") {
    return { status: "accepted", pollState: state };
  }
  return {
    status: "completed",
    media: {
      kind: "url",
      url: `${metadataUrl}:download?alt=media`,
      mimeType: state.mimeType,
      requiresProviderAuth: true,
    },
    interactionId: state.interactionId,
  };
}
