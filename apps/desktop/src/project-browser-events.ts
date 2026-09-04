export const PROJECT_BROWSER_OPEN_TAB_CHANNEL =
  "clash:project-browser-open-tab";

export interface ProjectBrowserOpenTabRequest {
  url: string;
  disposition: string;
}

export function isProjectBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.href === "about:blank"
    );
  } catch {
    return false;
  }
}
