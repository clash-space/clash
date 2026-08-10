/**
 * Vertex long-running operations, as two translations.
 *
 * Vertex accepts a video job on `:predictLongRunning`, names it, and answers questions about that
 * name on `:fetchPredictOperation`. Nothing here waits: `googleagentSubmit` sends the work and
 * reports what Vertex called it, `googleagentPoll` asks once and reports what Vertex said. How
 * often to ask, and for how long, is the host's decision now.
 *
 * It used to be this file's decision, as a loop of 108 attempts five seconds apart. Nine minutes
 * came from nowhere in particular, and it sat beside six other loops with six other ceilings. The
 * operation name lived in a local variable for the duration, so a host that stopped mid-loop lost a
 * video Vertex was still rendering and still charging for.
 */

/**
 * What Vertex needs in order to be asked about the job again.
 *
 * The operation name alone is not enough: `fetchPredictOperation` is addressed per project,
 * location and model, so the whole address travels with it. None of it is secret — the access token
 * is passed separately on each call, because this state is persisted next to the node and a service
 * account's key has no business being written there.
 */
export interface GoogleAgentPlatformPollState {
  operationName: string;
  project: string;
  location: string;
  model: string;
}

/**
 * Vertex returns the video inline, so this carries bytes rather than a link.
 *
 * Left as base64 rather than decoded: the plugin result protocol transports bytes as base64 anyway,
 * so decoding here only to re-encode at the boundary would be work with no reader.
 */
export interface GoogleAgentPlatformMedia {
  dataBase64: string;
  mimeType: string;
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
 * The `done` values that mean the render is still in flight.
 *
 * There is no status word to enumerate here. An Operation reports progress through `done`, which is
 * absent while the job runs and `false` when Vertex spells it out; those two are the whole set.
 * Naming it as a set is the point. `done` merely being falsy used to stand for "still running",
 * which quietly handed every reply that was not an Operation an unbounded wait.
 */
const RUNNING_DONE_VALUES: readonly unknown[] = [undefined, false];

/**
 * Vertex spells the global endpoint as the bare host; every other location is a prefix.
 *
 * Prefixing `global` produces a hostname that does not resolve, and an operation started against
 * one host is not visible to another, so this is part of addressing the job rather than a detail.
 */
function vertexBaseHost(location: string): string {
  return location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
}

function modelUrl(
  target: { project: string; location: string; model: string },
  action: string,
): string {
  return `https://${vertexBaseHost(target.location)}/v1/projects/${target.project}`
    + `/locations/${target.location}/publishers/google/models/${target.model}:${action}`;
}

/**
 * Reads a Vertex reply, preferring the message it wrote to the status line it sent.
 *
 * A body that is not JSON is kept as the error message rather than discarded: a proxy in front of
 * Vertex answers with HTML, and "502" alone does not say that a proxy was involved.
 */
async function readOperation(
  response: Awaited<ReturnType<FetchLike>>,
  what: string,
): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let body: Record<string, unknown>;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = { error: { message: raw } };
  }
  if (!response.ok) {
    const error = body.error as { message?: unknown } | undefined;
    throw new Error(
      `Google Cloud Agent Platform video ${what} failed: ${String(error?.message ?? response.statusText)}`,
    );
  }
  return body;
}

export async function googleagentSubmit(options: {
  project: string;
  location: string;
  model: string;
  accessToken: string;
  body: Record<string, unknown>;
  fetch: FetchLike;
}): Promise<{ pollState: GoogleAgentPlatformPollState }> {
  const target = { project: options.project, location: options.location, model: options.model };
  const response = await options.fetch(modelUrl(target, "predictLongRunning"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(options.body),
  });
  const submitted = await readOperation(response, "request");
  const operationName = submitted.name;
  if (typeof operationName !== "string" || !operationName) {
    // Reporting success here would leave the host waiting on a render it can never ask about, and
    // Vertex may well have started one.
    throw new Error(
      `Google Cloud Agent Platform video response returned no operation name for ${options.model}.`,
    );
  }
  return { pollState: { operationName, ...target } };
}

export type GoogleAgentPlatformPollResult =
  | { status: "accepted"; pollState: GoogleAgentPlatformPollState }
  | { status: "completed"; media: GoogleAgentPlatformMedia; requestId: string; model: string };

export async function googleagentPoll(options: {
  state: GoogleAgentPlatformPollState;
  accessToken: string;
  fetch: FetchLike;
}): Promise<GoogleAgentPlatformPollResult> {
  const { operationName, project, location, model } = options.state;
  const response = await options.fetch(modelUrl({ project, location, model }, "fetchPredictOperation"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    // The operation travels in the payload rather than the path. A GET on this URL answers with the
    // model's own metadata and would never report the job as finished.
    body: JSON.stringify({ operationName }),
  });
  const operation = await readOperation(response, "poll");

  const done = operation.done;

  if (done !== true) {
    // Accepted is returned only for a reply this executor can place: one that names the operation it
    // asked about and has not reported done. Unchanged state -- the operation keeps its name for as
    // long as it exists.
    //
    // The inverse used to be here, and it is the one mistake in polling with no symptom. Treating
    // whatever is not done as still running means anything shaped differently from an Operation --
    // most concretely the model's own metadata, which is what this path answers with when asked as
    // a GET, and which never carries `done` -- is polled forever while the render it was meant to
    // track has already finished or failed. The node sits at generating and nothing happens.
    if (RUNNING_DONE_VALUES.includes(done) && operation.name === operationName) {
      return { status: "accepted", pollState: options.state };
    }
    throw new Error(
      `Google Cloud Agent Platform video poll for ${operationName} returned a reply this executor `
      + `does not recognise as that operation still running: done=${JSON.stringify(done)}, `
      + `name=${JSON.stringify(operation.name)}. Refusing to keep waiting on work whose state is `
      + "unknown.",
    );
  }

  if (operation.error) {
    // A failed operation arrives as an ordinary 200 with `done` set and the failure inside. Reading
    // past this would hand back an operation with no video and call it success. The payload is
    // truncated because Vertex attaches the full request to some failures.
    throw new Error(
      `Google Cloud Agent Platform video request failed: ${JSON.stringify(operation.error).slice(0, 500)}`,
    );
  }

  const inline = inlineVideo(operation);
  if (!inline) {
    const uri = videoUri(operation);
    if (uri) {
      // Vertex answers with a `gs://` uri when the request asked it to write to a bucket, and that
      // is not reachable with the bearer token in hand. Naming it here says what happened; letting
      // it through produces a download failure elsewhere that reads like a network fault.
      throw new Error(
        `Google Cloud Agent Platform video returned a URI instead of inline bytes: ${uri}`,
      );
    }
    throw new Error(
      `Google Cloud Agent Platform video response returned no video for ${model}.`,
    );
  }

  return { status: "completed", media: inline, requestId: operationName, model };
}

/**
 * Vertex has spelled the sample list three ways and the sample itself two, across revisions that
 * are all still answered by the live API depending on the model.
 */
function videoSamples(operation: Record<string, unknown>): unknown[] {
  const response = (operation.response ?? operation) as Record<string, unknown>;
  const samples = response.generated_samples ?? response.generatedVideos ?? response.videos ?? [];
  return Array.isArray(samples) ? samples : [];
}

function videoObject(sample: unknown): Record<string, unknown> {
  const candidate = sample as { video?: unknown } | null;
  return ((candidate?.video ?? sample) ?? {}) as Record<string, unknown>;
}

function inlineVideo(operation: Record<string, unknown>): GoogleAgentPlatformMedia | null {
  for (const sample of videoSamples(operation)) {
    const video = videoObject(sample);
    const data = video.bytesBase64Encoded ?? video.data;
    if (typeof data === "string" && data) {
      const mimeType = video.mimeType ?? video.mime_type;
      return { dataBase64: data, mimeType: typeof mimeType === "string" ? mimeType : "video/mp4" };
    }
  }
  return null;
}

function videoUri(operation: Record<string, unknown>): string | null {
  for (const sample of videoSamples(operation)) {
    const video = videoObject(sample);
    const uri = video.uri ?? video.gcsUri ?? video.gcs_uri;
    if (typeof uri === "string" && uri) return uri;
  }
  return null;
}
