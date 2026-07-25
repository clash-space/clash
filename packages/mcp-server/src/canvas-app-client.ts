import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";

type CanvasNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
};
type CanvasEdge = { id: string; source: string; target: string };
type Snapshot = { projectId?: string; canvasId?: string; nodes?: CanvasNode[]; edges?: CanvasEdge[] };

const app = new App({ name: "Clash Studio", version: "0.1.0" });
const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
const stage = document.querySelector<HTMLElement>("[data-canvas-stage]")!;
const world = document.querySelector<HTMLElement>("[data-world]")!;
const nodeLayer = document.querySelector<HTMLElement>("[data-nodes]")!;
const edgeLayer = document.querySelector<SVGSVGElement>("[data-edges]")!;
const status = document.querySelector<HTMLOutputElement>("[data-status]")!;
const empty = document.querySelector<HTMLElement>("[data-empty]")!;
const noteForm = document.querySelector<HTMLFormElement>("[data-note-form]")!;
const noteInput = noteForm.elements.namedItem("label") as HTMLInputElement;

let snapshot: Snapshot = { nodes: [], edges: [] };
let view = { x: 0, y: 0, zoom: 1 };
let pan: { pointerId: number; x: number; y: number; originX: number; originY: number } | null = null;
let drag: { pointerId: number; node: CanvasNode; x: number; y: number } | null = null;

function structured(result: { structuredContent?: unknown }): Snapshot {
  return (result.structuredContent ?? {}) as Snapshot;
}

function transformWorld(): void {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
}

function nodeCopy(node: CanvasNode): string {
  const value = node.data?.content ?? node.data?.prompt ?? node.data?.description ?? "";
  return typeof value === "string" ? value : "";
}

function nodeLabel(node: CanvasNode): string {
  const value = node.data?.label;
  return typeof value === "string" && value.trim() ? value : node.id;
}

function render(): void {
  nodeLayer.replaceChildren();
  edgeLayer.replaceChildren();
  const nodes = snapshot.nodes ?? [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  empty.hidden = nodes.length > 0;

  for (const edge of snapshot.edges ?? []) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const sx = source.position.x + 240;
    const sy = source.position.y + 56;
    const tx = target.position.x;
    const ty = target.position.y + 56;
    const bend = Math.max(60, Math.abs(tx - sx) * .42);
    line.setAttribute("d", `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "color-mix(in srgb, var(--ink) 28%, transparent)");
    line.setAttribute("stroke-width", "1.5");
    edgeLayer.append(line);
  }

  for (const node of nodes) {
    const element = document.createElement("article");
    element.dataset.node = node.id;
    element.style.transform = `translate(${node.position.x}px, ${node.position.y}px)`;
    element.innerHTML = `<div data-node-kind>${node.type}</div><div data-node-title></div><div data-node-copy></div>`;
    element.querySelector<HTMLElement>("[data-node-title]")!.textContent = nodeLabel(node);
    element.querySelector<HTMLElement>("[data-node-copy]")!.textContent = nodeCopy(node);
    element.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      element.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, node, x: event.clientX, y: event.clientY };
    });
    element.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId || drag.node.id !== node.id) return;
      node.position = {
        x: node.position.x + (event.clientX - drag.x) / view.zoom,
        y: node.position.y + (event.clientY - drag.y) / view.zoom,
      };
      drag.x = event.clientX;
      drag.y = event.clientY;
      requestAnimationFrame(render);
    });
    element.addEventListener("pointerup", async (event) => {
      if (!drag || drag.pointerId !== event.pointerId || drag.node.id !== node.id) return;
      drag = null;
      status.value = "Saving position…";
      const result = await app.callServerTool({
        name: "clash_canvas_move",
        arguments: {
          projectId: snapshot.projectId,
          canvasId: snapshot.canvasId,
          nodeId: node.id,
          x: node.position.x,
          y: node.position.y,
        },
      });
      status.value = result.isError ? "Move rejected" : "Position saved";
    });
    nodeLayer.append(element);
  }
}

function applyDisplayMode(displayMode: "inline" | "pip" | "fullscreen"): void {
  shell.dataset.displayMode = displayMode;
}

async function refresh(): Promise<void> {
  status.value = "Refreshing…";
  const result = await app.callServerTool({
    name: "clash_canvas_snapshot",
    arguments: { projectId: snapshot.projectId, canvasId: snapshot.canvasId },
  });
  if (!result.isError) snapshot = structured(result);
  render();
  status.value = result.isError ? "Refresh failed" : `${snapshot.nodes?.length ?? 0} nodes`;
}

function zoomBy(factor: number, centerX = stage.clientWidth / 2, centerY = stage.clientHeight / 2): void {
  const next = Math.min(2, Math.max(.2, view.zoom * factor));
  const worldX = (centerX - view.x) / view.zoom;
  const worldY = (centerY - view.y) / view.zoom;
  view.x = centerX - worldX * next;
  view.y = centerY - worldY * next;
  view.zoom = next;
  transformWorld();
}

function fit(): void {
  const nodes = snapshot.nodes ?? [];
  if (!nodes.length) { view = { x: 0, y: 0, zoom: 1 }; transformWorld(); return; }
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + 240));
  const maxY = Math.max(...nodes.map((node) => node.position.y + 120));
  const zoom = Math.min(1, Math.max(.2, Math.min((stage.clientWidth - 100) / (maxX - minX), (stage.clientHeight - 100) / (maxY - minY))));
  view = { x: (stage.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (stage.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom, zoom };
  transformWorld();
}

stage.addEventListener("pointerdown", (event) => {
  if ((event.target as HTMLElement).closest("[data-node]")) return;
  stage.setPointerCapture(event.pointerId);
  pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
});
stage.addEventListener("pointermove", (event) => {
  if (!pan || pan.pointerId !== event.pointerId) return;
  view.x = pan.originX + event.clientX - pan.x;
  view.y = pan.originY + event.clientY - pan.y;
  requestAnimationFrame(transformWorld);
});
stage.addEventListener("pointerup", () => { pan = null; });
stage.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomBy(event.deltaY < 0 ? 1.1 : .9, event.clientX, event.clientY);
}, { passive: false });

document.querySelector("[data-refresh]")!.addEventListener("click", () => void refresh());
document.querySelector("[data-fit]")!.addEventListener("click", fit);
document.querySelector("[data-zoom-in]")!.addEventListener("click", () => zoomBy(1.15));
document.querySelector("[data-zoom-out]")!.addEventListener("click", () => zoomBy(.85));
for (const control of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"))) {
  control.addEventListener("click", async () => {
    const requested = control.dataset.mode as "inline" | "pip" | "fullscreen";
    const available = app.getHostContext()?.availableDisplayModes;
    if (available && !available.includes(requested)) {
      status.value = `${requested} is not available in this host`;
      return;
    }
    const result = await app.requestDisplayMode({ mode: requested });
    applyDisplayMode(result.mode);
  });
}
document.querySelector("[data-add-note]")!.addEventListener("click", () => {
  noteForm.dataset.open = "true";
  noteInput.focus();
});
noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = noteInput.value.trim();
  if (!label) return;
  const result = await app.callServerTool({
    name: "clash_canvas_add",
    arguments: { projectId: snapshot.projectId, canvasId: snapshot.canvasId, type: "text", label, content: "" },
  });
  if (!result.isError) {
    noteInput.value = "";
    noteForm.dataset.open = "false";
    await refresh();
  }
});

app.ontoolresult = (result) => {
  const incoming = structured(result);
  if (incoming.nodes) {
    snapshot = incoming;
    render();
    requestAnimationFrame(fit);
  }
};
app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.displayMode) applyDisplayMode(context.displayMode);
};
app.onerror = (error) => { status.value = error instanceof Error ? error.message : "Canvas connection failed"; };

await app.connect();
applyDisplayMode(app.getHostContext()?.displayMode ?? "inline");
status.value = "Connected";
await refresh();
