import type { ProjectBrowserTab } from "../components/ProjectWorkspaceNavigator";

export interface ProjectBrowserSession {
  tabs: ProjectBrowserTab[];
  activeBrowserId: string | null;
}

const PROJECT_BROWSER_SESSION_VERSION = 1;

function projectBrowserSessionStorageKey(projectId: string): string {
  return `clash:project:${encodeURIComponent(projectId)}:browser-session:v1`;
}

function browserTabFromStored(value: unknown): ProjectBrowserTab | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.id ||
    typeof candidate.title !== "string" ||
    typeof candidate.url !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
  };
}

export function loadProjectBrowserSession(
  storage: Pick<Storage, "getItem">,
  projectId: string,
): ProjectBrowserSession | null {
  try {
    const raw = storage.getItem(projectBrowserSessionStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.version !== PROJECT_BROWSER_SESSION_VERSION ||
      !Array.isArray(parsed.tabs)
    ) {
      return null;
    }
    const seen = new Set<string>();
    const tabs = parsed.tabs.flatMap((value) => {
      const tab = browserTabFromStored(value);
      if (!tab || seen.has(tab.id)) return [];
      seen.add(tab.id);
      return [tab];
    });
    const activeBrowserId =
      typeof parsed.activeBrowserId === "string" &&
      tabs.some((tab) => tab.id === parsed.activeBrowserId)
        ? parsed.activeBrowserId
        : null;
    return { tabs, activeBrowserId };
  } catch {
    return null;
  }
}

export function saveProjectBrowserSession(
  storage: Pick<Storage, "setItem">,
  projectId: string,
  session: ProjectBrowserSession,
): void {
  try {
    storage.setItem(
      projectBrowserSessionStorageKey(projectId),
      JSON.stringify({
        version: PROJECT_BROWSER_SESSION_VERSION,
        tabs: session.tabs.map(({ id, title, url }) => ({ id, title, url })),
        activeBrowserId: session.activeBrowserId,
      }),
    );
  } catch {
    // Browser state persistence is best-effort and must not block navigation.
  }
}

export function openProjectBrowserTab(
  tabs: readonly ProjectBrowserTab[],
  id: string,
  initial?: { url?: string; title?: string },
): { tabs: ProjectBrowserTab[]; tab: ProjectBrowserTab } {
  const url = initial?.url?.trim() || "about:blank";
  let title = initial?.title?.trim();
  if (!title && url !== "about:blank") {
    try {
      title = new URL(url).host || "New Browser";
    } catch {
      title = "New Browser";
    }
  }
  const tab: ProjectBrowserTab = {
    id,
    title: title || "New Browser",
    url,
  };
  return { tabs: [...tabs, tab], tab };
}

export function shouldActivateProjectBrowserTab(disposition: string): boolean {
  return disposition !== "background-tab";
}

export function updateProjectBrowserTab(
  tabs: readonly ProjectBrowserTab[],
  id: string,
  patch: Partial<Pick<ProjectBrowserTab, "title" | "url">>,
): ProjectBrowserTab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
}

export function closeProjectBrowserTab(
  tabs: readonly ProjectBrowserTab[],
  id: string,
): { tabs: ProjectBrowserTab[]; nextBrowserId: string | null } {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return { tabs: [...tabs], nextBrowserId: null };
  const remaining = tabs.filter((tab) => tab.id !== id);
  return {
    tabs: remaining,
    nextBrowserId: remaining[Math.min(index, remaining.length - 1)]?.id ?? null,
  };
}

export function ensureProjectBrowserTab(
  tabs: readonly ProjectBrowserTab[],
  id: string,
  title: string,
  url: string,
): ProjectBrowserTab[] {
  if (tabs.some((tab) => tab.id === id)) return [...tabs];
  return [...tabs, { id, title, url }];
}
