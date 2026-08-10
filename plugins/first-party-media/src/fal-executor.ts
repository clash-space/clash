/**
 * fal's queue API, as two translations.
 *
 * fal takes a job, returns a request id, and answers status questions about it. Nothing here waits:
 * `falSubmit` sends the work and reports what fal called it, `falPoll` asks once and reports what
 * fal said. The host decides how often to ask and for how long.
 *
 * That decision used to live in this code, as a loop of 240 attempts a second apart. Four minutes
 * was not a considered number — a start/end-frame video measured on this machine took 275 seconds —
 * and it sat alongside six other loops with six other ceilings, none of them derived from anything.
 */

export interface FalPollState {
  requestId: string;
  /** fal addresses status by endpoint as well as id, so both travel together. */
  endpoint: string;
}

export interface FalMedia {
  url: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<Record<string, unknown>>;
}>;

const DEFAULT_QUEUE_BASE_URL = "https://queue.fal.run";

function queueUrl(baseUrl: string | undefined, path: string): string {
  const base = (baseUrl ?? DEFAULT_QUEUE_BASE_URL).replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
}

async function readJson(
  response: Awaited<ReturnType<FetchLike>>,
  what: string,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail
      ?? (body.error as { message?: unknown } | undefined)?.message
      ?? response.statusText;
    throw new Error(`fal ${what} failed: ${String(detail)}`);
  }
  return body;
}

export async function falSubmit(options: {
  endpoint: string;
  apiKey: string;
  body: Record<string, unknown>;
  fetch: FetchLike;
  queueBaseUrl?: string;
}): Promise<{ pollState: FalPollState }> {
  const response = await options.fetch(queueUrl(options.queueBaseUrl, options.endpoint), {
    method: "POST",
    headers: {
      authorization: `Key ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(options.body),
  });
  const submitted = await readJson(response, "request");
  const requestId = submitted.request_id ?? submitted.requestId;
  if (typeof requestId !== "string" || !requestId) {
    // Reporting success here would leave the host waiting on work it can never ask about, and the
    // job may well be running and billable on fal's side.
    throw new Error("fal response returned no request_id");
  }
  return { pollState: { requestId, endpoint: options.endpoint } };
}

export type FalPollResult =
  | { status: "accepted"; pollState: FalPollState }
  | { status: "completed"; media: FalMedia; requestId: string; endpoint: string };

export async function falPoll(options: {
  state: FalPollState;
  apiKey: string;
  kind: "image" | "video" | "audio";
  fetch: FetchLike;
  queueBaseUrl?: string;
  readMedia?: (data: unknown, kind: "image" | "video" | "audio") => FalMedia;
}): Promise<FalPollResult> {
  const { requestId, endpoint } = options.state;
  const headers = { authorization: `Key ${options.apiKey}` };
  const requestPath = `${endpoint}/requests/${encodeURIComponent(requestId)}`;

  const statusBody = await readJson(
    await options.fetch(queueUrl(options.queueBaseUrl, `${requestPath}/status`), { headers }),
    "status",
  );
  const status = String(statusBody.status ?? "");
  if (status === "FAILED" || status === "ERROR") {
    throw new Error(`fal request failed: ${String(statusBody.error ?? status)}`);
  }
  if (status !== "COMPLETED") {
    // Unchanged state: fal identifies the job the same way for as long as it exists.
    return { status: "accepted", pollState: options.state };
  }

  const resultBody = await readJson(
    await options.fetch(queueUrl(options.queueBaseUrl, requestPath), { headers }),
    "result",
  );
  const readMedia = options.readMedia ?? defaultReadMedia;
  return {
    status: "completed",
    media: readMedia(resultBody.data ?? resultBody, options.kind),
    requestId,
    endpoint,
  };
}

function defaultReadMedia(data: unknown, kind: "image" | "video" | "audio"): FalMedia {
  const payload = (data ?? {}) as Record<string, unknown>;
  const slot = kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
  const direct = payload[slot] as { url?: unknown; width?: unknown; height?: unknown } | undefined;
  const listed = Array.isArray(payload[`${slot}s`])
    ? (payload[`${slot}s`] as Array<{ url?: unknown; width?: unknown; height?: unknown }>)[0]
    : undefined;
  const chosen = direct ?? listed;
  const url = chosen?.url ?? payload.url;
  if (typeof url !== "string" || !url) throw new Error("fal result carried no media url");
  return {
    url,
    ...(typeof chosen?.width === "number" ? { width: chosen.width } : {}),
    ...(typeof chosen?.height === "number" ? { height: chosen.height } : {}),
  };
}
