/**
 * localStorage-backed invited-crew list, scoped by project_id.
 *
 * The room-side identity (which crew member shows up as a tab) doesn't
 * round-trip through the server — it's a pure client preference, so
 * persistence lives in the browser. SSR-safe: every entry guards
 * `typeof window`, returning empty/no-op when called from a server
 * render (the loader path).
 */

const invitedKey = (projectId: string) => `clash:invitedCrew:${projectId}`;

export function loadInvited(projectId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(invitedKey(projectId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveInvited(projectId: string, ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(invitedKey(projectId), JSON.stringify(ids));
  } catch {
    // Quota exceeded / disabled — silent. UI just won't persist.
  }
}
