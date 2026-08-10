/**
 * Replicate's prediction API, as two translations.
 *
 * Replicate accepts a prediction, names it, and answers reads about it until it reaches a terminal
 * state. Nothing here waits: `replicateSubmit` creates the prediction and reports how to find it
 * again, `replicatePoll` reads it once and reports what Replicate said. How often to ask, and for
 * how long, is the host's decision now.
 *
 * It used to be this file's decision, as a loop of 240 attempts a second apart. Four minutes was
 * not a considered number -- a start/end-frame video measured on this machine took 275 seconds --
 * and it sat beside six other loops with six other ceilings, none of them traceable to anything a
 * model declares. The prediction id lived in a local variable for the duration, so a host that
 * stopped mid-loop lost a generation Replicate had already started charging for.
 */

export interface ReplicatePollState {
  predictionId: string;
  /**
   * Where to read this prediction back.
   *
   * Replicate supplies the address in the creation response, and it is kept rather than rebuilt.
   * Reconstructing it from the id assumes every prediction lives at the same place we sent it,
   * which stops being true the moment one is served from a different region or moved.
   */
  getUrl: string;
}

export interface ReplicateMedia {
  url: string;
}

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

const DEFAULT_BASE_URL = "https://api.replicate.com/v1";

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/**
 * Replicate creates predictions under the model that will run them, not at a single endpoint, so
 * the owner and the name are both part of the address. A bare model name would post to a path that
 * does not exist and fail with a 404 that says nothing about the cause.
 */
function predictionCreateUrl(baseUrl: string, upstreamModel: string): string {
  const [owner, model] = upstreamModel.split("/", 2);
  if (!owner || !model) {
    throw new Error(`Replicate model must be owner/name, received ${upstreamModel}`);
  }
  return `${baseUrl}/models/${encodeURIComponent(owner)}/${encodeURIComponent(model)}/predictions`;
}

async function readJson(
  response: Awaited<ReturnType<FetchLike>>,
  what: string,
): Promise<Record<string, unknown>> {
  const body = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const detail = body.detail
      ?? asRecord(body.error).message
      ?? response.statusText;
    throw new Error(`Replicate ${what} failed: ${String(detail)}`);
  }
  return body;
}

/**
 * Replicate's terminal states, read the way Replicate spells them.
 *
 * `canceled` is terminal and is not a success. Watching only for `succeeded` would leave a
 * cancelled prediction looking like one that is merely slow, and the host would keep asking until
 * its budget ran out and then report a timeout that hides the real reason.
 */
function predictionState(prediction: Record<string, unknown>): "pending" | "success" | "failed" {
  const state = String(prediction.status ?? "").toLowerCase();
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "canceled") return "failed";
  return "pending";
}

export async function replicateSubmit(options: {
  upstreamModel: string;
  apiKey: string;
  input: Record<string, unknown>;
  fetch: FetchLike;
  baseUrl?: string;
}): Promise<{ pollState: ReplicatePollState }> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const response = await options.fetch(predictionCreateUrl(baseUrl, options.upstreamModel), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    // Replicate reads the model's own parameters from `input`. Sent flat they are ignored rather
    // than rejected, which yields a default generation nobody asked for and a bill for it.
    body: JSON.stringify({ input: options.input }),
  });
  const prediction = await readJson(response, "request");

  const predictionId = prediction.id;
  if (typeof predictionId !== "string" || !predictionId) {
    // Reporting success here would leave the host holding work it can never read back, while
    // Replicate runs and charges for it.
    throw new Error(`Replicate response returned no prediction id for ${options.upstreamModel}`);
  }

  const suppliedUrl = asRecord(prediction.urls).get;
  return {
    pollState: {
      predictionId,
      getUrl: typeof suppliedUrl === "string" && suppliedUrl
        ? suppliedUrl
        : `${baseUrl}/predictions/${encodeURIComponent(predictionId)}`,
    },
  };
}

export type ReplicatePollResult =
  | { status: "accepted"; pollState: ReplicatePollState }
  | { status: "completed"; media: ReplicateMedia; requestId: string };

export async function replicatePoll(options: {
  state: ReplicatePollState;
  apiKey: string;
  fetch: FetchLike;
}): Promise<ReplicatePollResult> {
  const prediction = await readJson(
    await options.fetch(options.state.getUrl, {
      headers: { authorization: `Bearer ${options.apiKey}` },
    }),
    "status",
  );

  const state = predictionState(prediction);
  if (state === "failed") {
    throw new Error(`Replicate request failed: ${String(prediction.error ?? prediction.status ?? "failed")}`);
  }
  if (state === "pending") {
    // Unchanged: Replicate keeps the prediction at the same address for as long as it exists.
    return { status: "accepted", pollState: options.state };
  }

  // Falling back to the whole prediction is deliberate. Some models report their result at the top
  // level rather than under `output`, and this fallback is what makes those work.
  const url = firstResultUrl(prediction.output ?? prediction);
  if (!url) {
    // Succeeded with nothing to fetch is a broken model. Calling it completed would attach an empty
    // asset to the node and close the task as though it had worked.
    throw new Error(`Replicate response returned no media URL for ${options.state.predictionId}`);
  }
  return { status: "completed", media: { url }, requestId: options.state.predictionId };
}

/**
 * Finds the result url in an output whose shape belongs to the model author, not to Replicate.
 *
 * The same endpoint returns a bare string, an array of strings, or an object keyed by media type,
 * depending on who wrote the model. The keys are searched in a fixed order rather than by walking
 * the whole document, which is what keeps `urls.get` -- an https string sitting in the same
 * prediction -- from being mistaken for a result and handed to the host to download as media.
 */
function firstResultUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstResultUrl(item);
      if (url) return url;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of [
    "resultUrls",
    "fullResultUrls",
    "originUrls",
    "output",
    "images",
    "videos",
    "audios",
    "image",
    "video",
    "audio",
    "url",
    "uri",
    "response",
    "data",
  ]) {
    const url = firstResultUrl(record[key]);
    if (url) return url;
  }
  return undefined;
}
