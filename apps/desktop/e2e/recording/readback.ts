type JsonRecord = Record<string, unknown>;

export interface ProjectSnapshot {
  canvas: JsonRecord;
  edges: JsonRecord;
  timelines: JsonRecord;
  timelineRenders: JsonRecord;
  directorStages: JsonRecord;
}

function recordValue(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

async function hostCommand(options: {
  apiBaseUrl: string;
  projectId: string;
  action: string;
  input?: JsonRecord;
  fetchFn: typeof fetch;
  signal: AbortSignal;
}): Promise<JsonRecord> {
  const url = new URL(
    `/api/v1/projects/${encodeURIComponent(options.projectId)}/host-command`,
    options.apiBaseUrl,
  );
  const response = await new Promise<Response>((resolve, reject) => {
    const onAbort = () =>
      reject(new Error("Project snapshot read timed out or was aborted"));
    if (options.signal.aborted) {
      onAbort();
      return;
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
    void options
      .fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: options.action, ...options.input }),
        signal: options.signal,
      })
      .then(resolve, reject)
      .finally(() => options.signal.removeEventListener("abort", onAbort));
  });
  const body = recordValue(await response.json());
  if (!response.ok) {
    throw new Error(`${options.action} failed with HTTP ${response.status}`);
  }
  if (!body) throw new Error(`${options.action} returned a non-object response`);
  if (typeof body.error === "string") {
    throw new Error(`${options.action} failed: ${body.error}`);
  }
  return body;
}

export async function readProjectSnapshot(options: {
  apiBaseUrl: string;
  projectId: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ProjectSnapshot> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Project snapshot timeoutMs must be finite and positive");
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const command = (action: string, input?: JsonRecord) =>
    hostCommand({
      apiBaseUrl: options.apiBaseUrl,
      projectId: options.projectId,
      action,
      input,
      fetchFn,
      signal,
    });

  const canvas = await command("list");
  const edges = await command("edges");
  const timelines = await command("list_timelines");
  const timelineRenders = await command("list_timeline_renders", { status: "all" });
  const directorStages = await command("list_director_stages");

  return { canvas, edges, timelines, timelineRenders, directorStages };
}
