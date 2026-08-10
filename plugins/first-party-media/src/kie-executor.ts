/**
 * KIE's job API, as two translations.
 *
 * KIE takes a task, returns a task id, and answers status questions about it. Nothing here waits:
 * `kieSubmit` sends the work and reports what KIE called it, `kiePoll` asks once and reports what
 * KIE said. The host decides how often to ask and for how long.
 *
 * That decision used to live in this code, as a loop of 240 attempts a second apart. Four minutes
 * was not a considered number — a start/end-frame video measured on this machine took 275 seconds —
 * and it sat alongside six other loops with six other ceilings, none of them derived from anything.
 */

export interface KiePollState {
  taskId: string;
  /**
   * The model the task was created for.
   *
   * KIE addresses status by task id alone, so this is not needed to ask the question. It is needed
   * to answer it: a finished generation is reported against the model that produced it, and poll is
   * the only place left that could say which one.
   */
  model: string;
}

export interface KieMedia {
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

const DEFAULT_BASE_URL = "https://api.kie.ai";

function baseUrlOf(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Reads a field that KIE may send as either a string or a number.
 *
 * `errorCode` in particular arrives numeric, and a string-only read would skip past it to a vaguer
 * message — discarding the one part of a failure that identifies which failure it was.
 */
function detailField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Reads a KIE response, treating an error code in the body as an error.
 *
 * KIE reports application failures in `code` while the transport still returns 200 — an expired key
 * comes back as a perfectly successful HTTP request carrying `code: 401`. Checking only the status
 * line would read that envelope as a task and poll an id that never existed.
 */
async function readJson(
  response: Awaited<ReturnType<FetchLike>>,
  what: string,
): Promise<Record<string, unknown>> {
  const body = asRecord(await response.json().catch(() => ({})));
  const code = body.code;
  const numericCode = typeof code === "number"
    ? code
    : typeof code === "string" && code.trim() !== "" ? Number(code) : undefined;
  const failedCode = numericCode !== undefined && !Number.isNaN(numericCode) && numericCode >= 400;
  if (!response.ok || failedCode) {
    const detail = stringField(body, "msg")
      ?? stringField(asRecord(body.error), "message")
      ?? response.statusText;
    throw new Error(`KIE ${what} failed: ${detail}`);
  }
  return body;
}

export async function kieSubmit(options: {
  model: string;
  apiKey: string;
  input: Record<string, unknown>;
  fetch: FetchLike;
  baseUrl?: string;
}): Promise<{ pollState: KiePollState }> {
  const response = await options.fetch(`${baseUrlOf(options.baseUrl)}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: options.model, input: options.input }),
  });
  const created = await readJson(response, "request");

  // Three places, tried in this order, because that is where responses have actually carried it.
  // A chain this specific is a record of models encountered, not defensive padding.
  const taskId = stringField(asRecord(created.data), "taskId")
    ?? stringField(created, "taskId")
    ?? stringField(created, "id");
  if (!taskId) {
    // Reporting success here would leave the host waiting on work it can never ask about, while KIE
    // may well be running and billing it.
    throw new Error(`KIE response returned no taskId for ${options.model}`);
  }
  return { pollState: { taskId, model: options.model } };
}

export type KiePollResult =
  | { status: "accepted"; pollState: KiePollState }
  | { status: "completed"; media: KieMedia; taskId: string; model: string };

export async function kiePoll(options: {
  state: KiePollState;
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}): Promise<KiePollResult> {
  const { taskId, model } = options.state;
  const url = `${baseUrlOf(options.baseUrl)}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
  const task = await readJson(
    await options.fetch(url, { headers: { authorization: `Bearer ${options.apiKey}` } }),
    "status",
  );

  const state = kieTaskState(task);
  if (state === "failed") {
    const data = asRecord(task.data);
    const detail = detailField(data, "errorMessage")
      ?? detailField(data, "errorCode")
      ?? detailField(task, "msg")
      ?? "failed";
    throw new Error(`KIE request failed: ${detail}`);
  }
  if (state === "pending") {
    // Unchanged state: KIE identifies the task the same way for as long as it exists.
    return { status: "accepted", pollState: options.state };
  }

  const mediaUrl = firstResultUrl(task);
  if (!mediaUrl) {
    // A task KIE calls finished but hands back nothing is not a result. Passing it on as completed
    // would produce an asset pointing at nothing, which reads downstream as a delivered generation.
    throw new Error(`KIE response returned no media URL for ${taskId}`);
  }
  return { status: "completed", media: { url: mediaUrl }, taskId, model };
}

/**
 * Two vocabularies for the same answer, because KIE's models do not agree.
 *
 * Some return a numeric `successFlag`, others a state string under one of three names. The flag is
 * checked first, matching the order the original used against real traffic: where a response
 * carries both, the flag is the one that has been right.
 */
function kieTaskState(body: Record<string, unknown>): "pending" | "success" | "failed" {
  const task = body.data === undefined || body.data === null ? body : asRecord(body.data);
  const flag = task.successFlag;
  if (flag === 1 || flag === "1") return "success";
  if (flag === 2 || flag === 3 || flag === "2" || flag === "3") return "failed";
  const state = String(task.state ?? task.status ?? task.taskStatus ?? "").toLowerCase();
  if (state === "success" || state === "succeeded" || state === "completed") return "success";
  if (state === "fail" || state === "failed" || state === "error" || state === "canceled") return "failed";
  return "pending";
}

/**
 * Walks a KIE result for the first thing that looks like a media URL.
 *
 * The url arrives under a different key per model, and sometimes nested a level or two deeper than
 * the last model put it. The key list is ordered so that the more specific result fields are found
 * before the generic `data`, which otherwise swallows the search.
 */
const RESULT_URL_KEYS = [
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
] as const;

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
  for (const key of RESULT_URL_KEYS) {
    const url = firstResultUrl(record[key]);
    if (url) return url;
  }
  return undefined;
}
