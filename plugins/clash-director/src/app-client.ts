import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";

type Vector3 = [number, number, number];
type StageObject = {
  id: string;
  name: string;
  kind: string;
  visible?: boolean;
  color?: string;
  transform?: { position?: Vector3; rotation?: Vector3; scale?: Vector3 };
  [key: string]: unknown;
};
type StageCamera = {
  id: string;
  name: string;
  position?: Vector3;
  rotation?: Vector3;
  fov?: number;
  targetObjectId?: string;
};
type StageState = {
  schemaVersion?: number;
  scene?: { backgroundColor?: string; environmentAssetId?: string; grid?: { visible?: boolean; snap?: boolean; size?: number } };
  objects?: StageObject[];
  cameras?: StageCamera[];
  shots?: unknown[];
  animation?: { durationSeconds?: number; fps?: number; tracks?: Array<{ id: string; targetId?: string; keyframes?: Array<{ id: string; time: number }> }> };
};
type DirectorEntity = {
  id: string;
  name: string;
  revisionId?: string;
  owner?: { kind?: string; canvasId?: string };
  state?: StageState;
};
type WorkspacePayload = {
  cwd?: string;
  stages?: DirectorEntity[];
  selected?: DirectorEntity;
  stage?: DirectorEntity;
};

const app = new App({ name: "Clash Director", version: "0.1.0" });
const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
const cwdInput = document.querySelector<HTMLInputElement>("[data-workspace-cwd]")!;
const stageList = document.querySelector<HTMLElement>("[data-stage-list]")!;
const sceneTree = document.querySelector<HTMLElement>("[data-scene-tree]")!;
const viewport = document.querySelector<HTMLElement>("[data-viewport]")!;
const viewportStage = document.querySelector<HTMLElement>("[data-viewport-stage]")!;
const viewportEmpty = document.querySelector<HTMLElement>("[data-empty]")!;
const timelineTracks = document.querySelector<HTMLElement>("[data-timeline-tracks]")!;
const inspector = document.querySelector<HTMLFormElement>("[data-inspector-content]")!;
const selectedName = document.querySelector<HTMLElement>("[data-selected-name]")!;
const selectedMeta = document.querySelector<HTMLElement>("[data-selected-meta]")!;
const saveButton = document.querySelector<HTMLButtonElement>("[data-save]")!;
const status = document.querySelector<HTMLOutputElement>("[data-status]")!;
const createForm = document.querySelector<HTMLFormElement>("[data-create-stage]")!;

let stages: DirectorEntity[] = [];
let selected: DirectorEntity | null = null;
let draft: StageState | null = null;
let selection: { kind: "object" | "camera"; id: string } | null = null;

function setStatus(message: string, state: "idle" | "error" | "success" = "idle"): void {
  status.value = message;
  status.dataset.state = state;
}

function toolError(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text") as { text?: unknown } | undefined;
  return typeof text?.text === "string" ? text.text : "Director operation failed";
}

async function callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(toolError(result));
  return result.structuredContent && typeof result.structuredContent === "object"
    ? result.structuredContent as Record<string, unknown>
    : {};
}

function currentCwd(): string { return cwdInput.value.trim(); }
function objects(): StageObject[] { return Array.isArray(draft?.objects) ? draft.objects : []; }
function cameras(): StageCamera[] { return Array.isArray(draft?.cameras) ? draft.cameras : []; }
function ownerLabel(stage: DirectorEntity): string {
  return stage.owner?.kind === "canvas-action" ? `Canvas · ${stage.owner.canvasId ?? "main"}` : "Project";
}
function markDirty(dirty = true): void { saveButton.disabled = !selected || !dirty; }

function buttonText(primary: string, secondary: string): HTMLElement {
  const copy = document.createElement("span");
  copy.style.minWidth = "0";
  const name = document.createElement("span");
  name.dataset.name = "";
  name.textContent = primary;
  const meta = document.createElement("span");
  meta.dataset.meta = "";
  meta.textContent = secondary;
  meta.style.display = "block";
  copy.append(name, meta);
  return copy;
}

function renderStageList(): void {
  stageList.replaceChildren();
  if (!stages.length) {
    const message = document.createElement("p");
    message.dataset.meta = "";
    message.style.padding = ".75rem";
    message.textContent = "No Director Stages in this workspace.";
    stageList.append(message);
    return;
  }
  for (const stage of stages) {
    const row = document.createElement("button");
    row.type = "button";
    row.dataset.stageRow = stage.id;
    row.setAttribute("aria-current", String(selected?.id === stage.id));
    row.append(buttonText(stage.name, ownerLabel(stage)));
    const counts = document.createElement("span");
    counts.dataset.meta = "";
    counts.textContent = `${stage.state?.objects?.length ?? 0} / ${stage.state?.cameras?.length ?? 0}`;
    row.append(counts);
    row.addEventListener("click", () => void openStage(stage.id));
    stageList.append(row);
  }
}

function sceneRow(kind: "object" | "camera", id: string, name: string, meta: string): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.dataset.sceneRow = id;
  row.setAttribute("aria-current", String(selection?.kind === kind && selection.id === id));
  row.append(buttonText(name, meta));
  const glyph = document.createElement("span");
  glyph.textContent = kind === "camera" ? "◉" : "◆";
  glyph.style.color = kind === "camera" ? "var(--director-camera)" : "var(--director-selection)";
  row.append(glyph);
  row.addEventListener("click", () => {
    selection = { kind, id };
    renderAll();
  });
  return row;
}

function addButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.secondary = "";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderSceneTree(): void {
  sceneTree.replaceChildren();
  const actions = document.createElement("div");
  actions.style.display = "grid";
  actions.style.gridTemplateColumns = "1fr 1fr";
  actions.style.gap = ".35rem";
  actions.append(
    addButton("+ Object", () => {
      if (!draft) return;
      const id = `object-${Date.now().toString(36)}`;
      draft.objects = [...objects(), {
        id, name: `Object ${objects().length + 1}`, kind: "primitive", visible: true,
        color: "#ff6b50", transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        primitive: { shape: "box" },
      }];
      selection = { kind: "object", id };
      markDirty(); renderAll();
    }),
    addButton("+ Camera", () => {
      if (!draft) return;
      const id = `camera-${Date.now().toString(36)}`;
      draft.cameras = [...cameras(), { id, name: `Camera ${cameras().length + 1}`, position: [0, 1.6, 6], rotation: [0, 0, 0], fov: 50 }];
      selection = { kind: "camera", id };
      markDirty(); renderAll();
    }),
  );
  sceneTree.append(actions);
  for (const object of objects()) sceneTree.append(sceneRow("object", object.id, object.name, object.kind));
  for (const camera of cameras()) sceneTree.append(sceneRow("camera", camera.id, camera.name, `${camera.fov ?? 50}°`));
}

function objectPosition(value: number | undefined, axis: "x" | "z"): string {
  const normalized = Math.max(-8, Math.min(8, value ?? 0));
  return `${axis === "x" ? 50 + normalized * 5 : 46 + normalized * 3.5}%`;
}

function renderViewport(): void {
  viewportStage.replaceChildren();
  const entries = objects().filter((object) => object.visible !== false);
  viewportEmpty.hidden = Boolean(selected && entries.length);
  viewport.style.backgroundColor = draft?.scene?.backgroundColor ?? "var(--director-viewport)";
  entries.forEach((object, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.dataset.viewportObject = object.id;
    marker.style.setProperty("--object-color", object.color ?? "#5f9eff");
    marker.style.left = objectPosition(object.transform?.position?.[0] ?? index - entries.length / 2, "x");
    marker.style.top = objectPosition(object.transform?.position?.[2] ?? index, "z");
    marker.setAttribute("aria-selected", String(selection?.kind === "object" && selection.id === object.id));
    marker.textContent = object.name;
    marker.addEventListener("click", () => { selection = { kind: "object", id: object.id }; renderAll(); });
    viewportStage.append(marker);
  });
}

function renderTimeline(): void {
  timelineTracks.replaceChildren();
  const tracks = draft?.animation?.tracks ?? [];
  if (!tracks.length) {
    const empty = document.createElement("p");
    empty.dataset.meta = "";
    empty.style.padding = ".75rem";
    empty.textContent = "No animation tracks";
    timelineTracks.append(empty);
    return;
  }
  const duration = Math.max(1, draft?.animation?.durationSeconds ?? 10);
  for (const track of tracks) {
    const row = document.createElement("div");
    row.dataset.track = track.id;
    const label = document.createElement("strong");
    label.textContent = track.id;
    const keyframes = document.createElement("div");
    keyframes.dataset.keyframes = "";
    for (const keyframe of track.keyframes ?? []) {
      const marker = document.createElement("span");
      marker.dataset.keyframe = keyframe.id;
      marker.style.left = `${Math.max(0, Math.min(100, keyframe.time / duration * 100))}%`;
      keyframes.append(marker);
    }
    row.append(label, keyframes);
    timelineTracks.append(row);
  }
}

function field(labelText: string, value: string | number, onInput: (value: string) => void, type = "text"): HTMLElement {
  const label = document.createElement("label");
  label.dataset.field = "";
  const heading = document.createElement("label");
  heading.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.value = String(value);
  input.addEventListener("input", () => { onInput(input.value); markDirty(); renderViewport(); renderSceneTree(); });
  label.append(heading, input);
  return label;
}

function vectorField(labelText: string, value: Vector3, onInput: (value: Vector3) => void): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.dataset.field = "";
  const heading = document.createElement("label");
  heading.textContent = labelText;
  const vector = document.createElement("div");
  vector.dataset.vector = "";
  value.forEach((component, index) => {
    const input = document.createElement("input");
    input.type = "number";
    input.step = ".1";
    input.value = String(component);
    input.addEventListener("input", () => {
      const next = [...value] as Vector3;
      next[index] = Number(input.value);
      onInput(next); markDirty(); renderViewport();
    });
    vector.append(input);
  });
  wrapper.append(heading, vector);
  return wrapper;
}

function renderInspector(): void {
  inspector.replaceChildren();
  if (!draft || !selected) {
    const message = document.createElement("p"); message.dataset.meta = ""; message.textContent = "Select a Stage."; inspector.append(message); return;
  }
  if (selection?.kind === "object") {
    const object = objects().find((candidate) => candidate.id === selection?.id);
    if (object) {
      inspector.append(
        field("Name", object.name, (value) => { object.name = value; }),
        field("Color", object.color ?? "#ff6b50", (value) => { object.color = value; }, "color"),
        vectorField("Position", object.transform?.position ?? [0, 0, 0], (value) => { object.transform ??= {}; object.transform.position = value; }),
        vectorField("Rotation", object.transform?.rotation ?? [0, 0, 0], (value) => { object.transform ??= {}; object.transform.rotation = value; }),
        vectorField("Scale", object.transform?.scale ?? [1, 1, 1], (value) => { object.transform ??= {}; object.transform.scale = value; }),
      );
      return;
    }
  }
  if (selection?.kind === "camera") {
    const camera = cameras().find((candidate) => candidate.id === selection?.id);
    if (camera) {
      inspector.append(
        field("Name", camera.name, (value) => { camera.name = value; }),
        field("FOV", camera.fov ?? 50, (value) => { camera.fov = Number(value); }, "number"),
        vectorField("Position", camera.position ?? [0, 1.6, 6], (value) => { camera.position = value; }),
        vectorField("Rotation", camera.rotation ?? [0, 0, 0], (value) => { camera.rotation = value; }),
      );
      return;
    }
  }
  inspector.append(field("Background", draft.scene?.backgroundColor ?? "#08090c", (value) => {
    draft!.scene ??= {}; draft!.scene.backgroundColor = value;
  }, "color"));
}

function renderAll(): void {
  renderStageList(); renderSceneTree(); renderViewport(); renderTimeline(); renderInspector();
}

function selectStage(stage: DirectorEntity | null): void {
  selected = stage;
  draft = stage?.state ? structuredClone(stage.state) : null;
  selection = null;
  selectedName.textContent = stage?.name ?? "No Stage selected";
  selectedMeta.textContent = stage ? `${ownerLabel(stage)} · ${stage.revisionId ?? "unversioned"}` : "Read a Director Stage to begin.";
  markDirty(false);
  renderAll();
}

function applyPayload(payload: WorkspacePayload): void {
  if (payload.cwd) cwdInput.value = payload.cwd;
  if (payload.stages) stages = payload.stages;
  const stage = payload.stage ?? payload.selected;
  if (stage) {
    const index = stages.findIndex((candidate) => candidate.id === stage.id);
    if (index >= 0) stages[index] = stage; else stages.push(stage);
    selectStage(stage);
  } else renderAll();
}

async function refresh(): Promise<void> {
  setStatus("Reading Director Stages…");
  try {
    const payload = await callTool("clash_director_list", { cwd: currentCwd() });
    stages = Array.isArray(payload.items) ? payload.items as DirectorEntity[] : [];
    const current = selected && stages.find((stage) => stage.id === selected?.id);
    selectStage(current ?? stages[0] ?? null);
    setStatus(`${stages.length} Director Stage${stages.length === 1 ? "" : "s"}`, "success");
  } catch (error) { setStatus(error instanceof Error ? error.message : "Director refresh failed", "error"); }
}

async function openStage(stageId: string): Promise<void> {
  setStatus(`Opening ${stageId}…`);
  try {
    const payload = await callTool("clash_director_get", { cwd: currentCwd(), stageId });
    const stage = (payload.stage ?? payload) as DirectorEntity;
    applyPayload({ stage });
    setStatus(`Opened ${stage.name}`, "success");
  } catch (error) { setStatus(error instanceof Error ? error.message : "Director Stage open failed", "error"); }
}

document.querySelector("[data-refresh]")!.addEventListener("click", () => void refresh());
cwdInput.addEventListener("change", () => void refresh());
createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(createForm);
  const stageId = String(data.get("stageId") ?? "").trim();
  const name = String(data.get("name") ?? "").trim();
  if (!stageId || !name) return;
  try {
    await callTool("clash_director_create", { cwd: currentCwd(), stageId, name });
    createForm.reset(); await refresh(); await openStage(stageId);
  } catch (error) { setStatus(error instanceof Error ? error.message : "Director Stage create failed", "error"); }
});
saveButton.addEventListener("click", async () => {
  if (!selected || !draft) return;
  saveButton.disabled = true;
  setStatus(`Saving ${selected.name}…`);
  try {
    await callTool("clash_director_save", { cwd: currentCwd(), stageId: selected.id, state: draft });
    await openStage(selected.id);
    setStatus(`Saved ${selected.name}`, "success");
  } catch (error) { markDirty(); setStatus(error instanceof Error ? error.message : "Director Stage save failed", "error"); }
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
  if (payload && (payload.stages || payload.selected || payload.stage)) applyPayload(payload);
};
app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.displayMode) shell.dataset.displayMode = context.displayMode;
};
await app.connect();
shell.dataset.displayMode = app.getHostContext()?.displayMode ?? "inline";
setStatus("Connected. Open a Director Stage from Codex or enter a workspace path.");
