/**
 * Suno's task API, as two translations.
 *
 * Suno takes a job, returns a task id, and answers record-info questions about it. Nothing here
 * waits: `sunoSubmit` sends the work and reports what Suno called it, `sunoPoll` asks once and
 * reports what Suno said. The host decides how often to ask and for how long.
 *
 * That decision used to live in this code, as a loop of 120 attempts five seconds apart. Ten
 * minutes was not a considered number, and it sat alongside six other loops with six other
 * ceilings, none of them derived from anything.
 */

export interface SunoResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<Record<string, unknown>>;
}

export type SunoFetch = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<SunoResponse>;

/**
 * Suno identifies a task by id alone -- record-info takes nothing else -- so that is all that
 * travels between submit and poll.
 */
export interface SunoPollState {
  taskId: string;
}

export interface SunoMedia {
  url: string;
  durationMs?: number;
}

const DEFAULT_BASE_URL = "https://api.sunoapi.org";

/**
 * Statuses Suno will never move on from.
 *
 * `CALLBACK_EXCEPTION` is one of them: Suno mandates a callback address at create time and treats
 * its own failure to reach it as the task dying, even though the audio may have been generated.
 * Polling past it waits for a transition that never comes.
 */
const TERMINAL_FAILURES = new Set([
  "CREATE_TASK_FAILED",
  "GENERATE_AUDIO_FAILED",
  "CALLBACK_EXCEPTION",
  "SENSITIVE_WORD_ERROR",
]);

/**
 * Statuses worth asking again about. Everything outside this set ends the wait.
 *
 * Only `PENDING` is named because only `PENDING` is evidenced: it is the value this file substitutes
 * when Suno omits the status entirely, and it is the one running state the tests exercise. Adding
 * states nobody here has observed would be guessing about a provider, and a guess that reads as
 * still-running is exactly the guess that costs nothing to make and everything to be wrong about.
 *
 * The direction matters more than the contents. Asking "is this one of the states I know are
 * running?" bounds the wait to what someone considered. Asking "is this not SUCCESS?" -- which is
 * what stood here -- hands every unfamiliar word an unbounded wait: a state Suno adds later, a
 * spelling that differs between model families, a terminal failure phrased in a way
 * `TERMINAL_FAILURES` never learned. The node sits at generating and nothing happens, which is the
 * one failure here with no symptom.
 *
 * The cloud path this was ported from hid that behind a 120-attempt ceiling, so the mistake ended
 * itself after ten minutes. The split removed the ceiling along with the loop, and the host that
 * now schedules the asking has no vocabulary for this provider and cannot supply one.
 *
 * Naming too few is the cheap direction to be wrong in: an unrecognised status arrives as an error
 * quoting the word itself, on a run someone can look at, and adding it here is one line.
 */
const RUNNING_STATUSES = new Set([
  "PENDING",
]);

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Reads Suno's envelope, which reports failure twice and not always in agreement.
 *
 * Suno answers 200 OK and puts the real verdict in `code`, so an HTTP-only check reads a rejected
 * create as a successful one and then polls an id that was never issued.
 */
async function readEnvelope(
  response: SunoResponse,
  what: string,
): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || body.code !== 200) {
    const message = typeof body.msg === "string" && body.msg ? body.msg : response.statusText;
    throw new Error(`Suno API ${what} failed: ${message}`);
  }
  const data = body.data;
  return data && typeof data === "object" ? data as Record<string, unknown> : {};
}

export async function sunoSubmit(options: {
  apiKey: string;
  /** Suno refuses a task without one, so this is checked before spending a request. */
  callbackUrl: string | undefined;
  model: string;
  prompt?: string;
  modelParams?: Record<string, unknown>;
  fetch: SunoFetch;
  baseUrl?: string;
}): Promise<{ pollState: SunoPollState }> {
  if (!options.callbackUrl || !/^https:\/\//.test(options.callbackUrl)) {
    throw new Error("Suno provider account requires a public HTTPS callbackUrl.");
  }
  const style = stringParam(options.modelParams, "style");
  const title = stringParam(options.modelParams, "title");
  // Either both arrived or neither did. Suno rejects a half-specified custom mode itself, so this
  // only saves the round trip -- but it saves it on a request that could not have succeeded.
  const customMode = !!(style || title);
  if (customMode && (!style || !title)) {
    throw new Error("Suno custom mode requires both style and title.");
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const response = await options.fetch(`${baseUrl}/api/v1/generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      customMode,
      instrumental: options.modelParams?.instrumental === true,
      model: options.model,
      callBackUrl: options.callbackUrl,
      prompt: options.prompt,
      ...(customMode ? { style, title } : {}),
    }),
  });

  const data = await readEnvelope(response, "request");
  const taskId = data.taskId;
  if (typeof taskId !== "string" || !taskId) {
    // Suno may have started work regardless. Reporting success would leave the host holding a
    // billed task it has no id for, and therefore no way to ever collect or cancel.
    throw new Error(`Suno API response returned no taskId for ${options.model}`);
  }
  return { pollState: { taskId } };
}

export type SunoPollResult =
  | { status: "accepted"; pollState: SunoPollState }
  | { status: "completed"; media: SunoMedia; requestId: string };

export async function sunoPoll(options: {
  state: SunoPollState;
  apiKey: string;
  fetch: SunoFetch;
  baseUrl?: string;
}): Promise<SunoPollResult> {
  const { taskId } = options.state;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const response = await options.fetch(
    `${baseUrl}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    { method: "GET", headers: { authorization: `Bearer ${options.apiKey}` } },
  );

  const data = await readEnvelope(response, "status");
  // An absent status is Suno not having got to the task yet, not an answer. Reading the absence as
  // terminal would fail a job that is merely young.
  const status = String(data.status ?? "PENDING");
  if (TERMINAL_FAILURES.has(status)) {
    const reason = typeof data.errorMessage === "string" && data.errorMessage
      ? data.errorMessage
      : status;
    throw new Error(`Suno API generation failed: ${reason}`);
  }
  if (RUNNING_STATUSES.has(status)) {
    // Unchanged state: Suno identifies the task the same way for as long as it exists.
    return { status: "accepted", pollState: options.state };
  }
  if (status !== "SUCCESS") {
    // Neither running, nor finished, nor a failure this file knows by name. Continuing to poll
    // would be waiting on a state nobody can say is still alive.
    throw new Error(
      `Suno API task ${taskId} reported status "${status}", which this executor does not recognise. `
      + "Refusing to keep waiting on a task whose state is unknown.",
    );
  }

  const song = firstSong(data);
  const url = song?.audioUrl;
  if (typeof url !== "string" || !url) {
    // Suno reports SUCCESS before the track is addressable in at least some cases. Completing here
    // would mark the node done with nothing to fetch.
    throw new Error(`Suno API response returned no audioUrl for ${taskId}`);
  }
  return {
    status: "completed",
    requestId: taskId,
    media: {
      url,
      // Suno reports seconds where the rest of this plugin reports milliseconds.
      ...(typeof song?.duration === "number"
        ? { durationMs: Math.round(song.duration * 1000) }
        : {}),
    },
  };
}

function firstSong(
  data: Record<string, unknown>,
): { audioUrl?: unknown; duration?: number } | undefined {
  const response = data.response;
  if (!response || typeof response !== "object") return undefined;
  const sunoData = (response as { sunoData?: unknown }).sunoData;
  if (!Array.isArray(sunoData)) return undefined;
  const song = sunoData[0];
  if (!song || typeof song !== "object") return undefined;
  const { audioUrl, duration } = song as { audioUrl?: unknown; duration?: unknown };
  return {
    audioUrl,
    ...(typeof duration === "number" ? { duration } : {}),
  };
}
