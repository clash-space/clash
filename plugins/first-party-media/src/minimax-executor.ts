/**
 * MiniMax's generation APIs, as two translations.
 *
 * MiniMax answers in two different ways depending on what is being made. Video goes on a queue and
 * comes back as a task id to ask about; audio comes back in the same call with the bytes inline.
 * Both shapes live here, and neither waits — `minimaxSubmit` sends the work and reports whichever
 * answer MiniMax gave, `minimaxPoll` asks once about a queued task. The host decides how often to
 * ask and for how long.
 *
 * That decision used to live in the host as a loop of 180 attempts five seconds apart. Fifteen
 * minutes was the most generous of seven hand-written ceilings, none of them derived from anything,
 * and the task id lived in a local variable, so a host that stopped mid-loop lost a generation that
 * had already been billed.
 */

/**
 * MiniMax addresses a task by id and nothing else.
 *
 * No endpoint travels alongside it, as fal's does, and no model: the query path is the same for
 * every video model. Adding the model here because it happens to be available would be a second
 * copy of something the node already records, free to disagree with the first.
 */
export interface MinimaxPollState {
  taskId: string;
}

export interface MinimaxVideoMedia {
  url: string;
  durationMs?: number;
}

export interface MinimaxAudioMedia {
  bytes: Uint8Array;
  contentType: string;
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
  text(): Promise<string>;
}>;

/**
 * MiniMax answers on two hosts and an account works on exactly one of them: `minimax.io` for the
 * international service, `minimaxi.com` for the domestic one. The host is chosen by whoever holds
 * the account and arrives as `baseUrl`; this constant is only the fallback for accounts recorded
 * before that choice existed.
 */
const DEFAULT_BASE_URL = "https://api.minimax.io";

function apiUrl(baseUrl: string | undefined, path: string): string {
  return `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}${path}`;
}

/**
 * Reads a MiniMax response, keeping a non-JSON body visible.
 *
 * A gateway between here and MiniMax will answer with HTML, and folding that into an empty object
 * leaves only the status line to go on. Surfacing the text is the difference between diagnosing a
 * proxy and staring at "Bad Gateway".
 */
async function readBody(response: Awaited<ReturnType<FetchLike>>): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: { message: raw } };
  }
}

function nested(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function messageFrom(body: Record<string, unknown>, fallback: string): string {
  const error = nested(body, "error");
  const nestedMessage = error?.message;
  if (typeof nestedMessage === "string" && nestedMessage) return nestedMessage;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

/**
 * MiniMax's audio endpoints answer 200 and put the verdict in an envelope.
 *
 * A non-zero `status_code` alongside a successful HTTP status is how an expired key or a rejected
 * prompt arrives. Trusting the transport alone hands the host an empty result as though it worked,
 * so both are checked together — a transport failure carrying a zeroed envelope is still a failure.
 */
function assertAudioOk(
  ok: boolean,
  body: Record<string, unknown>,
  what: string,
  httpFallback: string,
): void {
  const baseResp = nested(body, "base_resp");
  if (ok && baseResp?.status_code === 0) return;
  const statusMsg = baseResp?.status_msg;
  throw new Error(
    `MiniMax ${what} request failed: `
      + (typeof statusMsg === "string" && statusMsg ? statusMsg : httpFallback),
  );
}

function hexToBytes(data: string): Uint8Array {
  const clean = data.trim();
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
    // An odd length means the payload was truncated in transit. Decoding it leniently would store a
    // corrupt asset that only fails later, when someone tries to play it.
    throw new Error("MiniMax response returned invalid hex media.");
  }
  return new Uint8Array(Buffer.from(clean, "hex"));
}

/**
 * Names the media type after the format MiniMax was told to produce.
 *
 * Read back out of the request body rather than passed alongside it, so the declared type cannot
 * drift from what was actually asked for. `pcm` is the trap: its registered type is `audio/L16`,
 * which shares no substring with the format name.
 */
function audioContentType(body: Record<string, unknown>): string {
  const format = nested(body, "audio_setting")?.format;
  if (format === "wav") return "audio/wav";
  if (format === "pcm") return "audio/L16";
  return "audio/mpeg";
}

export type MinimaxSubmitResult =
  | { status: "accepted"; pollState: MinimaxPollState }
  | { status: "completed"; media: MinimaxAudioMedia };

export async function minimaxSubmit(options: {
  kind: "audio" | "video";
  apiKey: string;
  body: Record<string, unknown>;
  fetch: FetchLike;
  baseUrl?: string;
  /** Music and speech share a shape but not an endpoint. */
  musicEndpoint?: boolean;
}): Promise<MinimaxSubmitResult> {
  const headers = {
    authorization: `Bearer ${options.apiKey}`,
    "content-type": "application/json",
  };

  if (options.kind === "audio") {
    const what = options.musicEndpoint ? "music" : "TTS";
    const path = options.musicEndpoint ? "/v1/music_generation" : "/v1/t2a_v2";
    const response = await options.fetch(apiUrl(options.baseUrl, path), {
      method: "POST",
      headers,
      body: JSON.stringify(options.body),
    });
    const body = await readBody(response);
    assertAudioOk(response.ok, body, what, response.statusText);

    const audio = nested(body, "data")?.audio;
    if (typeof audio !== "string" || !audio) {
      throw new Error(`MiniMax ${what} response returned no audio.`);
    }
    // `music_duration` is already milliseconds, unlike the video task's whole seconds. Scaling it
    // here as well would report every track a thousand times too long.
    const musicDuration = nested(body, "extra_info")?.music_duration;
    return {
      status: "completed",
      media: {
        bytes: hexToBytes(audio),
        contentType: audioContentType(options.body),
        ...(typeof musicDuration === "number" ? { durationMs: musicDuration } : {}),
      },
    };
  }

  const response = await options.fetch(apiUrl(options.baseUrl, "/v2/video_generation"), {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
  });
  const created = await readBody(response);
  if (!response.ok) {
    throw new Error(`MiniMax video request failed: ${messageFrom(created, response.statusText)}`);
  }
  const taskId = created.task_id;
  if (typeof taskId !== "string" || !taskId) {
    // Nothing to poll. Reporting success would leave the host waiting on work it can never ask
    // about, while the job may well be running and billable upstream.
    throw new Error("MiniMax video response returned no task_id.");
  }
  return { status: "accepted", pollState: { taskId } };
}

/**
 * The states MiniMax uses while a task is still alive.
 *
 * Named positively, because the alternative — accept anything that is not `succeeded` — hands every
 * word nobody has thought about yet to another poll. A state MiniMax adds later, or spells
 * differently for a new model family, would then be asked about until the host's own budget ran out,
 * with nothing to show for it: the node sits at `generating` and no error is ever raised.
 *
 * Three names, each with evidence. `queued` is what a missing status already defaults to, in the
 * moments after submission before MiniMax fills the field in. `processing` and `running` are both
 * observed intermediate states — the second from the sibling H3 implementation in api-cf, which
 * polls through it on the way to `succeeded`.
 *
 * Deliberately short. A state that is really still running costs one loud error on a run someone
 * can fix; the same state assumed to be running costs an indefinite wait that says nothing.
 */
const RUNNING_STATUSES = new Set(["queued", "processing", "running"]);

export type MinimaxPollResult =
  | { status: "accepted"; pollState: MinimaxPollState }
  | { status: "completed"; media: MinimaxVideoMedia; taskId: string };

export async function minimaxPoll(options: {
  state: MinimaxPollState;
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}): Promise<MinimaxPollResult> {
  const { taskId } = options.state;
  const response = await options.fetch(
    apiUrl(options.baseUrl, `/v2/query/video_generation/${encodeURIComponent(taskId)}`),
    { headers: { authorization: `Bearer ${options.apiKey}` } },
  );
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(`MiniMax video status failed: ${messageFrom(body, response.statusText)}`);
  }

  const task = nested(body, "task") ?? {};
  // MiniMax omits the field entirely in the moments after submission, and varies its casing.
  // Treating a missing status as terminal would abandon work that is merely young.
  const status = String(task.status ?? "queued").toLowerCase();

  // Two Ls. Replicate's equivalent state has one, and reusing a spelling across providers would
  // leave a dead job being polled until the host's own budget ran out.
  if (status === "failed" || status === "cancelled") {
    const taskError = nested(task, "error");
    const detail = typeof taskError?.message === "string" && taskError.message
      ? taskError.message
      : typeof task.message === "string" && task.message
        ? task.message
        : status;
    throw new Error(`MiniMax video generation failed: ${detail}`);
  }
  if (RUNNING_STATUSES.has(status)) {
    // Unchanged state: MiniMax identifies the task the same way for as long as it exists.
    return { status: "accepted", pollState: options.state };
  }
  if (status !== "succeeded") {
    // Neither finished, nor failed, nor a state this executor can vouch for as still running. The
    // quoted spelling is what MiniMax actually sent, so whoever reads this can add it here or find
    // out what it means.
    throw new Error(
      `MiniMax reported status "${String(task.status)}" for task ${taskId}, which this executor `
        + "does not recognise. Refusing to keep waiting on a task whose state is unknown.",
    );
  }

  const url = nested(task, "content")?.url;
  if (typeof url !== "string" || !url) {
    // A succeeded task with no url is not a result. Passing it on would store an asset pointing
    // nowhere, which reads as success everywhere except when someone opens it.
    throw new Error(`MiniMax video response returned no video URL for ${taskId}`);
  }
  return {
    status: "completed",
    media: {
      url,
      ...(typeof task.duration === "number" ? { durationMs: task.duration * 1000 } : {}),
    },
    taskId,
  };
}
