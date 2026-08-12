import { isAbsolute, relative, resolve } from "node:path";

import { configDir } from "./config";

/**
 * Where a plugin draft may live.
 *
 * The supported flow is: write the code in your own working directory, then
 * register it. `clash plugin activate <directory>` validates the draft, runs its
 * contracts, approves any capability increase, and copies it into product-internal
 * storage, which owns the result from then on -- content-hashed, recorded as an
 * activation, and rollback-protected.
 *
 * So the draft is the input and the stored copy is the output, and the two must not
 * share a home. A draft placed inside the managed root puts freely editable,
 * unattested source in the middle of attested state, and it invents a third meaning
 * for "drafts" -- everywhere else in the product that word means
 * `workspaceRoot/drafts`, a project's own scratch area.
 */

/** Guidance for the supported flow, without naming internal directories. */
export function managedStorageDraftHint(): string {
  return (
    "Keep plugin drafts in your own working directory, then register one with "
    + "`clash plugin activate <directory>`; Clash stores and owns the activated copy. "
    + "Start a new draft with `clash plugin create <directory>`, or pull an "
    + "active plugin out to edit with `clash plugin checkout <id> <directory>`."
  );
}

/** True when `candidate` is the managed root or lies beneath it. */
export function isInsideManagedStorage(
  candidate: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const managedRoot = resolve(configDir(env));
  const target = resolve(candidate);
  if (target === managedRoot) return true;
  const rel = relative(managedRoot, target);
  // `relative` yields a `..` prefix for anything outside the root, and an absolute
  // path when the two sit on different volumes. Comparing the strings directly would
  // wrongly reject a sibling such as `<root>-scratch`.
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Refuse a draft directory inside product-internal storage.
 *
 * Called by every command that takes a draft path, so the mistake is impossible
 * rather than merely documented.
 */
export function assertDraftOutsideManagedStorage(
  candidate: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!isInsideManagedStorage(candidate, env)) return;
  throw new Error(
    `Refusing to use ${resolve(candidate)} as a plugin draft: it is inside Clash's `
    + `product-internal storage, which holds activated plugins and their rollback `
    + `state. ${managedStorageDraftHint()}`,
  );
}
