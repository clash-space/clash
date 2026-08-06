import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";

type TimelineItem = {
  id: string;
  type?: string;
  from?: number;
  durationInFrames?: number;
  [key: string]: unknown;
};

type TimelineTrack = {
  id: string;
  name?: string;
  category?: string;
  role?: string;
  items?: TimelineItem[];
  [key: string]: unknown;
};

type TimelineEntity = {
  id: string;
  name: string;
  revisionId?: string;
  owner?: { kind?: string; canvasId?: string; actionNodeId?: string };
  state?: Record<string, unknown>;
};

type WorkspacePayload = {
  cwd?: string;
  timelines?: TimelineEntity[];
  selected?: TimelineEntity;
  timeline?: TimelineEntity;
};

type TimelineInspectorField = "from" | "durationInFrames";

type TimelineAppContract = {
  contractFingerprint: string;
  trackCategories: Array<{ id: string; label: string }>;
  defaultTrackCategory: string;
  inspector: {
    scope: "timing-only";
    editableItemFields: TimelineInspectorField[];
  };
};

declare global {
  interface Window {
    __CLASH_TIMELINE_APP_CONTRACT__?: TimelineAppContract;
  }
}

const injectedTimelineAppContract = window.__CLASH_TIMELINE_APP_CONTRACT__;
if (!injectedTimelineAppContract?.trackCategories.length) {
  throw new Error("Clash Timeline App contract was not injected by the MCP resource");
}
const timelineAppContract: TimelineAppContract = injectedTimelineAppContract;

const app = new App({ name: "Clash Timeline", version: "0.1.0" });
const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
const cwdInput = document.querySelector<HTMLInputElement>("[data-workspace-cwd]")!;
const listElement = document.querySelector<HTMLElement>("[data-timeline-list]")!;
const editor = document.querySelector<HTMLElement>("[data-editor]")!;
const trackLanes = document.querySelector<HTMLElement>("[data-track-lanes]")!;
const emptyState = document.querySelector<HTMLElement>("[data-empty-state]")!;
const selectedName = document.querySelector<HTMLElement>("[data-selected-name]")!;
const selectedMeta = document.querySelector<HTMLElement>("[data-selected-meta]")!;
const inspector = document.querySelector<HTMLElement>("[data-inspector-content]")!;
const saveButton = document.querySelector<HTMLButtonElement>("[data-save]")!;
const status = document.querySelector<HTMLOutputElement>("[data-status]")!;
const createForm = document.querySelector<HTMLFormElement>("[data-create-timeline]")!;
const trackForm = document.querySelector<HTMLFormElement>("[data-track-form]")!;

let timelines: TimelineEntity[] = [];
let selected: TimelineEntity | null = null;
let draftState: Record<string, unknown> | null = null;
let selectedItem: { trackId: string; itemId: string } | null = null;

const categoryOrder = timelineAppContract.trackCategories.map((category) => category.id);
const categoryLabels: Record<string, string> = Object.fromEntries(
  timelineAppContract.trackCategories.map((category) => [category.id, category.label]),
);
const defaultTrackCategory = timelineAppContract.defaultTrackCategory;
const inspectorFieldLabels: Record<TimelineInspectorField, string> = {
  from: "Start frame",
  durationInFrames: "Duration",
};

function setStatus(message: string, state: "idle" | "error" | "success" = "idle"): void {
  status.value = message;
  status.dataset.state = state;
}

function toolError(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((item) => (
    item && typeof item === "object" && (item as { type?: unknown }).type === "text"
  )) as { text?: unknown } | undefined;
  return typeof text?.text === "string" ? text.text : "Timeline operation failed";
}

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(toolError(result));
  return result.structuredContent && typeof result.structuredContent === "object"
    ? result.structuredContent as Record<string, unknown>
    : {};
}

function currentCwd(): string {
  return cwdInput.value.trim();
}

function tracks(): TimelineTrack[] {
  return draftState && Array.isArray(draftState.tracks)
    ? draftState.tracks as TimelineTrack[]
    : [];
}

function markDirty(dirty = true): void {
  editor.dataset.dirty = String(dirty);
  saveButton.disabled = !selected || !dirty;
}

function ownerLabel(timeline: TimelineEntity): string {
  return timeline.owner?.kind === "canvas-action"
    ? `Canvas · ${timeline.owner.canvasId ?? "main"}`
    : "Project";
}

function selectedItemValue(): TimelineItem | null {
  if (!selectedItem) return null;
  const track = tracks().find((candidate) => candidate.id === selectedItem?.trackId);
  return track?.items?.find((item) => item.id === selectedItem?.itemId) ?? null;
}

function renderList(): void {
  listElement.replaceChildren();
  if (!timelines.length) {
    const message = document.createElement("p");
    message.dataset.meta = "";
    message.textContent = "No timelines in this workspace yet.";
    listElement.append(message);
    return;
  }
  for (const timeline of timelines) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.timelineRow = timeline.id;
    button.setAttribute("aria-current", String(selected?.id === timeline.id));

    const copy = document.createElement("span");
    const name = document.createElement("span");
    const id = document.createElement("span");
    copy.style.minWidth = "0";
    name.dataset.timelineName = "";
    name.textContent = timeline.name || timeline.id;
    id.dataset.scope = "";
    id.textContent = timeline.id;
    copy.append(name, id);

    const scope = document.createElement("span");
    scope.dataset.scope = "";
    scope.textContent = ownerLabel(timeline);
    button.append(copy, scope);
    button.addEventListener("click", () => void openTimeline(timeline.id));
    listElement.append(button);
  }
}

function durationInFrames(): number {
  const declared = Number(draftState?.durationInFrames);
  const itemEnd = tracks().flatMap((track) => track.items ?? []).reduce((maximum, item) => {
    const from = Number(item.from ?? 0);
    const duration = Number(item.durationInFrames ?? 1);
    return Math.max(maximum, from + duration);
  }, 1);
  return Number.isFinite(declared) && declared > 0 ? Math.max(declared, itemEnd) : itemEnd;
}

function renderInspector(): void {
  inspector.replaceChildren();
  const item = selectedItemValue();
  if (!item) {
    const placeholder = document.createElement("p");
    placeholder.dataset.inspectorPlaceholder = "";
    placeholder.textContent = selected
      ? "Select a clip to inspect its timing."
      : "Select a timeline to inspect its cut.";
    inspector.append(placeholder);
    return;
  }

  const heading = document.createElement("strong");
  heading.textContent = item.id;
  const meta = document.createElement("span");
  meta.dataset.meta = "";
  meta.textContent = item.type ?? "item";
  const fields = document.createElement("div");
  fields.dataset.itemFields = "";

  const numberField = (key: TimelineInspectorField): HTMLLabelElement => {
    const label = document.createElement("label");
    label.textContent = inspectorFieldLabels[key];
    const input = document.createElement("input");
    input.type = "number";
    input.min = key === "from" ? "0" : "1";
    input.step = "1";
    input.value = String(Number(item[key] ?? (key === "from" ? 0 : 1)));
    input.addEventListener("change", () => {
      const value = Math.max(key === "from" ? 0 : 1, Math.round(Number(input.value)));
      item[key] = Number.isFinite(value) ? value : key === "from" ? 0 : 1;
      markDirty();
      renderTracks();
      renderInspector();
    });
    label.append(input);
    return label;
  };

  fields.append(...timelineAppContract.inspector.editableItemFields.map(numberField));
  inspector.append(heading, meta, fields);
}

function renderTracks(): void {
  trackLanes.replaceChildren();
  const stateTracks = tracks();
  emptyState.hidden = Boolean(selected) && stateTracks.length > 0;
  trackForm.hidden = !selected;
  if (!selected || !stateTracks.length) {
    renderInspector();
    return;
  }
  const total = durationInFrames();
  for (const track of stateTracks) {
    const lane = document.createElement("section");
    const category = track.category ?? defaultTrackCategory;
    lane.dataset.trackLane = track.id;
    lane.dataset.category = category;

    const label = document.createElement("div");
    label.dataset.trackLabel = "";
    const name = document.createElement("strong");
    name.textContent = track.name || track.id;
    const kind = document.createElement("span");
    kind.textContent = categoryLabels[category] ?? category;
    label.append(name, kind);

    const rail = document.createElement("div");
    rail.dataset.trackRail = "";
    for (const item of track.items ?? []) {
      const button = document.createElement("button");
      const from = Math.max(0, Number(item.from ?? 0));
      const duration = Math.max(1, Number(item.durationInFrames ?? 1));
      button.type = "button";
      button.dataset.item = item.id;
      button.style.left = `${Math.min(100, from / total * 100)}%`;
      button.style.width = `${Math.max(2, Math.min(100 - from / total * 100, duration / total * 100))}%`;
      button.setAttribute("aria-pressed", String(
        selectedItem?.trackId === track.id && selectedItem.itemId === item.id,
      ));
      button.textContent = item.id;
      button.title = `${item.id} · frame ${from} · ${duration} frames`;
      button.addEventListener("click", () => {
        selectedItem = { trackId: track.id, itemId: item.id };
        renderTracks();
        renderInspector();
      });
      rail.append(button);
    }
    lane.append(label, rail);
    trackLanes.append(lane);
  }
  renderInspector();
}

function selectTimeline(timeline: TimelineEntity | null): void {
  selected = timeline;
  selectedItem = null;
  draftState = timeline?.state && typeof timeline.state === "object"
    ? structuredClone(timeline.state)
    : timeline
      ? { tracks: [] }
      : null;
  selectedName.textContent = timeline?.name || "No timeline selected";
  selectedMeta.textContent = timeline
    ? `${ownerLabel(timeline)} · ${timeline.revisionId ?? "current revision"}`
    : "Select a timeline to inspect its cut.";
  markDirty(false);
  renderList();
  renderTracks();
}

function applyPayload(payload: WorkspacePayload): void {
  if (typeof payload.cwd === "string") cwdInput.value = payload.cwd;
  if (Array.isArray(payload.timelines)) timelines = payload.timelines;
  const incoming = payload.selected ?? payload.timeline;
  if (incoming) selectTimeline(incoming);
  else {
    const current = selected && timelines.find((timeline) => timeline.id === selected?.id);
    selectTimeline(current ?? timelines[0] ?? null);
  }
}

async function refresh(): Promise<void> {
  if (!currentCwd()) {
    setStatus("Enter the workspace path that contains .clash/project.toml.", "error");
    return;
  }
  setStatus("Reading timelines…");
  try {
    const payload = await callTool("clash_timeline_list", { cwd: currentCwd() });
    timelines = Array.isArray(payload.items) ? payload.items as TimelineEntity[] : [];
    const current = selected && timelines.find((timeline) => timeline.id === selected?.id);
    selectTimeline(current ?? timelines[0] ?? null);
    setStatus(`${timelines.length} timeline${timelines.length === 1 ? "" : "s"}`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Timeline refresh failed", "error");
  }
}

async function openTimeline(timelineId: string): Promise<void> {
  setStatus(`Opening ${timelineId}…`);
  try {
    const payload = await callTool("clash_timeline_get", { cwd: currentCwd(), timelineId });
    const timeline = (payload.timeline ?? payload) as TimelineEntity;
    const index = timelines.findIndex((candidate) => candidate.id === timeline.id);
    if (index >= 0) timelines[index] = timeline;
    selectTimeline(timeline);
    setStatus(`Opened ${timeline.name}`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Timeline open failed", "error");
  }
}

document.querySelector("[data-refresh]")!.addEventListener("click", () => void refresh());
cwdInput.addEventListener("change", () => void refresh());

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(createForm);
  const timelineId = String(data.get("timelineId") ?? "").trim();
  const name = String(data.get("name") ?? "").trim();
  if (!timelineId || !name) return;
  setStatus(`Creating ${name}…`);
  try {
    await callTool("clash_timeline_create", { cwd: currentCwd(), id: timelineId, name });
    createForm.reset();
    await refresh();
    await openTimeline(timelineId);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Timeline create failed", "error");
  }
});

trackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!draftState) return;
  const data = new FormData(trackForm);
  const trackId = String(data.get("trackId") ?? "").trim();
  const category = String(data.get("category") ?? defaultTrackCategory);
  if (!trackId || tracks().some((track) => track.id === trackId)) {
    setStatus(trackId ? `Track ${trackId} already exists.` : "Track ID is required.", "error");
    return;
  }
  const nextTracks = [...tracks(), { id: trackId, category, items: [] }]
    .sort((left, right) => categoryOrder.indexOf(left.category ?? defaultTrackCategory) - categoryOrder.indexOf(right.category ?? defaultTrackCategory));
  draftState.tracks = nextTracks;
  trackForm.reset();
  markDirty();
  renderTracks();
  setStatus(`Added ${categoryLabels[category] ?? category} track`, "success");
});

saveButton.addEventListener("click", async () => {
  if (!selected || !draftState) return;
  if (!selected.revisionId) {
    markDirty();
    setStatus("This Timeline has no revision id. Reload it before saving.", "error");
    return;
  }
  saveButton.disabled = true;
  setStatus(`Validating ${selected.name}…`);
  try {
    await callTool("clash_timeline_validate", {
      cwd: currentCwd(),
      document: draftState,
      format: "object",
    });
    setStatus(`Saving ${selected.name}…`);
    await callTool("clash_timeline_save", {
      cwd: currentCwd(),
      timelineId: selected.id,
      baseRevisionId: selected.revisionId,
      state: draftState,
    });
    await openTimeline(selected.id);
    setStatus(`Saved ${selected.name}`, "success");
  } catch (error) {
    markDirty();
    setStatus(error instanceof Error ? error.message : "Timeline save failed", "error");
  }
});

for (const control of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"))) {
  control.addEventListener("click", async () => {
    const mode = control.dataset.mode as "inline" | "fullscreen";
    const result = await app.requestDisplayMode({ mode });
    shell.dataset.displayMode = result.mode;
  });
}

app.ontoolresult = (result) => {
  const payload = result.structuredContent as WorkspacePayload | undefined;
  if (payload && (payload.timelines || payload.selected || payload.timeline)) applyPayload(payload);
};
app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.displayMode) shell.dataset.displayMode = context.displayMode;
};
await app.connect();
shell.dataset.displayMode = app.getHostContext()?.displayMode ?? "inline";
setStatus("Connected. Open a Timeline from Codex or enter a workspace path.");
