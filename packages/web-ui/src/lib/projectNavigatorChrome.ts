export const PROJECT_NAVIGATOR_VISIBILITY_EVENT =
  "clash:project-navigator-visibility";

export interface ProjectNavigatorVisibilityDetail {
  collapsed: boolean;
}

export function readProjectNavigatorCollapsed(): boolean {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem("project-navigator-collapsed") === "true"
  );
}

export function setProjectNavigatorCollapsedFromChrome(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    "project-navigator-collapsed",
    String(collapsed),
  );
  window.dispatchEvent(
    new CustomEvent<ProjectNavigatorVisibilityDetail>(
      PROJECT_NAVIGATOR_VISIBILITY_EVENT,
      { detail: { collapsed } },
    ),
  );
}
