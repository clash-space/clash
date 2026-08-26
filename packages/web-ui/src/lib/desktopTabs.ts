export interface DesktopTab {
  id: string;
  title: string;
  path: string;
  connection?: DesktopTabConnection;
}

export type DesktopTabConnection =
  | "connecting"
  | "connected"
  | "disconnected";

export interface DesktopTabState {
  tabs: DesktopTab[];
  activeTabId: string;
}

export interface CloseDesktopTabResult extends DesktopTabState {
  nextPath: string;
}

export const DESKTOP_TAB_TITLE_EVENT = "clash:desktop-tab-title";
export const DESKTOP_TAB_CONNECTION_EVENT = "clash:desktop-tab-connection";

export interface DesktopTabTitleEventDetail {
  path: string;
  title: string;
}

export interface DesktopTabConnectionEventDetail {
  path: string;
  connection?: DesktopTabConnection;
}

export function dispatchDesktopTabConnection(
  detail: DesktopTabConnectionEventDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DESKTOP_TAB_CONNECTION_EVENT, { detail }),
  );
}

export function isDesktopWorkspaceTabPath(path: string): boolean {
  return path === "/settings" || /^\/projects\/[^/]+$/.test(path);
}

function normalizedDesktopTabTitle(title: string): string {
  return title.trim() || "Untitled";
}

export function titleForDesktopPath(path: string): string {
  if (path === "/") return "Home";
  if (path === "/projects") return "Projects";
  if (path === "/assets") return "Assets";
  if (path === "/marketplace" || path === "/marketplace/manage") return "Store";
  if (path.startsWith("/projects/")) return "Project";

  const segment = path.split("/").filter(Boolean).at(-1);
  if (!segment) return "Home";
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function createDesktopTab(path: string, id: string): DesktopTab {
  return { id, title: titleForDesktopPath(path), path };
}

export function appendDesktopTab(
  tabs: DesktopTab[],
  path: string,
  id: string,
): DesktopTabState {
  return { tabs: [...tabs, createDesktopTab(path, id)], activeTabId: id };
}

export function activateOrAppendDesktopTab(
  tabs: DesktopTab[],
  path: string,
  id: string,
): DesktopTabState {
  const existing = tabs.find((tab) => tab.path === path);
  return existing
    ? { tabs, activeTabId: existing.id }
    : appendDesktopTab(tabs, path, id);
}

export function activateDesktopPath(
  tabs: DesktopTab[],
  path: string,
  id: string,
  dashboardId = "tab-home",
): DesktopTabState {
  if (isDesktopWorkspaceTabPath(path)) {
    return activateOrAppendDesktopTab(tabs, path, id);
  }

  const dashboardTab =
    tabs.find((tab) => tab.path === "/") ?? createDesktopTab("/", dashboardId);
  return {
    tabs: tabs.some((tab) => tab.id === dashboardTab.id)
      ? tabs
      : [dashboardTab, ...tabs],
    activeTabId: dashboardTab.id,
  };
}

export function updateDesktopTabPath(
  tabs: DesktopTab[],
  activeTabId: string,
  path: string,
): DesktopTab[] {
  return tabs.map((tab) =>
    tab.id === activeTabId ? createDesktopTab(path, tab.id) : tab,
  );
}

export function updateDesktopTabTitle(
  tabs: DesktopTab[],
  path: string,
  title: string,
): DesktopTab[] {
  const nextTitle = normalizedDesktopTabTitle(title);
  return tabs.map((tab) =>
    tab.path === path ? { ...tab, title: nextTitle } : tab,
  );
}

export function updateDesktopTabConnection(
  tabs: DesktopTab[],
  path: string,
  connection: DesktopTabConnection | undefined,
): DesktopTab[] {
  return tabs.map((tab) => {
    if (tab.path !== path) return tab;
    if (connection === undefined) {
      const { connection: _connection, ...rest } = tab;
      return rest;
    }
    return { ...tab, connection };
  });
}

export function closeDesktopTab(
  tabs: DesktopTab[],
  activeTabId: string,
  tabIdToClose: string,
  fallbackId = "tab-home",
): CloseDesktopTabResult {
  const closedIndex = tabs.findIndex((tab) => tab.id === tabIdToClose);
  const remainingTabs = tabs.filter((tab) => tab.id !== tabIdToClose);

  if (remainingTabs.length === 0) {
    const fallbackTab = createDesktopTab("/", fallbackId);
    return {
      tabs: [fallbackTab],
      activeTabId: fallbackTab.id,
      nextPath: fallbackTab.path,
    };
  }

  if (tabIdToClose !== activeTabId) {
    const activeTab =
      remainingTabs.find((tab) => tab.id === activeTabId) ?? remainingTabs[0];
    return {
      tabs: remainingTabs,
      activeTabId: activeTab.id,
      nextPath: activeTab.path,
    };
  }

  const nextActiveIndex = Math.min(
    Math.max(closedIndex, 0),
    remainingTabs.length - 1,
  );
  const nextActiveTab = remainingTabs[nextActiveIndex];
  return {
    tabs: remainingTabs,
    activeTabId: nextActiveTab.id,
    nextPath: nextActiveTab.path,
  };
}
