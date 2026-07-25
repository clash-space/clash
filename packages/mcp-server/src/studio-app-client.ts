import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";

type Project = { id: string; name?: string };
type StudioPayload = {
  cwd?: string;
  host?: { status?: string; endpoint?: string; launchMode?: string };
  projects?: Project[];
};

const app = new App({ name: "Clash Studio", version: "0.1.0" });
const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
const hostStatus = document.querySelector<HTMLElement>("[data-host-status]")!;
const hostEndpoint = document.querySelector<HTMLElement>("[data-host-endpoint]")!;
const projectList = document.querySelector<HTMLOListElement>("[data-project-list]")!;
const projectCount = document.querySelector<HTMLElement>("[data-project-count]")!;
const empty = document.querySelector<HTMLElement>("[data-empty]")!;
const status = document.querySelector<HTMLOutputElement>("[data-status]")!;

function render(payload: StudioPayload): void {
  const active = payload.host?.status === "active";
  hostStatus.dataset.state = active ? "active" : "inactive";
  hostStatus.textContent = active
    ? `Host active${payload.host?.launchMode ? ` · ${payload.host.launchMode}` : ""}`
    : "Host inactive";
  hostEndpoint.textContent = payload.host?.endpoint ?? "Open Clash Desktop or start local-api.";

  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  projectCount.textContent = `${projects.length} project${projects.length === 1 ? "" : "s"}`;
  empty.hidden = projects.length > 0;
  projectList.replaceChildren();
  projects.forEach((project, index) => {
    const row = document.createElement("li");
    row.dataset.projectRow = project.id;
    const number = document.createElement("span");
    number.dataset.projectIndex = "";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.dataset.projectName = "";
    name.textContent = project.name?.trim() || project.id;
    const id = document.createElement("span");
    id.dataset.projectId = "";
    id.textContent = project.id;
    row.append(number, name, id);
    projectList.append(row);
  });
}

async function refresh(): Promise<void> {
  status.value = "Reading local host…";
  const result = await app.callServerTool({ name: "clash_studio_open", arguments: {} });
  if (result.isError) {
    status.value = "Clash host is unavailable";
    render({ host: { status: "inactive" }, projects: [] });
    return;
  }
  render((result.structuredContent ?? {}) as StudioPayload);
  status.value = "Connected to the local Clash host";
}

document.querySelector("[data-refresh]")!.addEventListener("click", () => void refresh());
for (const control of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mode]"))) {
  control.addEventListener("click", async () => {
    const requested = control.dataset.mode as "inline" | "fullscreen";
    const available = app.getHostContext()?.availableDisplayModes;
    if (available && !available.includes(requested)) {
      status.value = `${requested} is not available in this host`;
      return;
    }
    const result = await app.requestDisplayMode({ mode: requested });
    shell.dataset.displayMode = result.mode;
  });
}

app.ontoolresult = (result) => {
  const payload = result.structuredContent as StudioPayload | undefined;
  if (payload?.host || payload?.projects) render(payload);
};
app.onhostcontextchanged = (context) => {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.displayMode) shell.dataset.displayMode = context.displayMode;
};
app.onerror = () => { status.value = "Clash Studio connection failed"; };

await app.connect();
shell.dataset.displayMode = app.getHostContext()?.displayMode ?? "inline";
await refresh();
