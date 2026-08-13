import type { LoroDoc } from "loro-crdt";

import type { ActionAssetBinding } from "./assets.js";
import {
  createActionAssetBinding,
  listActionAssetReferences,
  readActionAssetBinding,
  unbindActionAssetBinding,
} from "./action-asset-bindings.js";
import { listProjectAssets, readProjectAsset } from "./project-assets.js";

export const PROJECT_PRESENTATION_CONTAINER = "projectPresentation";
export const PROJECT_COVER_ACTION_ID = "project-cover";
const COVER_BINDING_ID_KEY = "coverBindingId";

function isProjectCoverBinding(binding: ActionAssetBinding): boolean {
  return (
    binding.owner.kind === "draft" &&
    binding.owner.actionId === PROJECT_COVER_ACTION_ID &&
    binding.direction === "input" &&
    binding.slot === "cover"
  );
}

function projectCoverBindings(doc: LoroDoc): ActionAssetBinding[] {
  return listProjectAssets(doc)
    .flatMap((asset) => listActionAssetReferences(doc, asset.id))
    .filter(isProjectCoverBinding)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function storedCoverBindingId(doc: LoroDoc): string | null {
  const presentation = doc.getMap(PROJECT_PRESENTATION_CONTAINER);
  const bindingId = presentation.get(COVER_BINDING_ID_KEY);
  return typeof bindingId === "string" && bindingId ? bindingId : null;
}

function currentCoverBinding(doc: LoroDoc): ActionAssetBinding | null {
  const bindingId = storedCoverBindingId(doc);
  if (!bindingId) return null;
  return (
    projectCoverBindings(doc).find((binding) => binding.id === bindingId) ??
    null
  );
}

export function readProjectCoverAssetId(doc: LoroDoc): string | null {
  return currentCoverBinding(doc)?.projectAssetId ?? null;
}

export type ProjectCoverMutationResult =
  | { ok: true; coverAssetId: string | null; changed: boolean }
  | {
      ok: false;
      error: {
        code:
          | "PROJECT_ASSET_NOT_FOUND"
          | "PROJECT_ASSET_NOT_ACTIVE"
          | "INVALID_COVER_BINDING_ID"
          | "PROJECT_COVER_BINDING_FAILED";
        message: string;
      };
    };

export function setProjectCoverAsset(
  doc: LoroDoc,
  input: { projectAssetId: string | null; bindingId?: string },
): ProjectCoverMutationResult {
  const projectAssetId = input.projectAssetId?.trim() || null;
  const current = currentCoverBinding(doc);
  if (current?.projectAssetId === projectAssetId) {
    return { ok: true, coverAssetId: projectAssetId, changed: false };
  }

  if (projectAssetId) {
    const asset = readProjectAsset(doc, projectAssetId);
    if (!asset) {
      return {
        ok: false,
        error: {
          code: "PROJECT_ASSET_NOT_FOUND",
          message: `Project Asset ${projectAssetId} not found.`,
        },
      };
    }
    if (asset.lifecycle.state !== "active") {
      return {
        ok: false,
        error: {
          code: "PROJECT_ASSET_NOT_ACTIVE",
          message: `Project Asset ${projectAssetId} is not active.`,
        },
      };
    }
    if (!input.bindingId?.trim()) {
      return {
        ok: false,
        error: {
          code: "INVALID_COVER_BINDING_ID",
          message: "A new Project cover requires a unique binding id.",
        },
      };
    }
    if (readActionAssetBinding(doc, input.bindingId.trim())) {
      return {
        ok: false,
        error: {
          code: "INVALID_COVER_BINDING_ID",
          message: `Action Asset binding ${input.bindingId.trim()} already exists.`,
        },
      };
    }
  }

  const presentation = doc.getMap(PROJECT_PRESENTATION_CONTAINER);
  if (!projectAssetId) {
    if (current) {
      const unbound = unbindActionAssetBinding(doc, current.id);
      if (!unbound.ok) {
        return {
          ok: false,
          error: {
            code: "PROJECT_COVER_BINDING_FAILED",
            message: unbound.error.message,
          },
        };
      }
    }
    presentation.delete(COVER_BINDING_ID_KEY);
    return { ok: true, coverAssetId: null, changed: current !== null };
  }

  const binding: ActionAssetBinding = {
    id: input.bindingId!.trim(),
    owner: { kind: "draft", actionId: PROJECT_COVER_ACTION_ID },
    direction: "input",
    slot: "cover",
    projectAssetId,
    role: "primary",
  };
  const created = createActionAssetBinding(doc, binding);
  if (!created.ok) {
    return {
      ok: false,
      error: {
        code: "PROJECT_COVER_BINDING_FAILED",
        message: created.error.message,
      },
    };
  }
  if (current) {
    const unbound = unbindActionAssetBinding(doc, current.id);
    if (!unbound.ok) {
      return {
        ok: false,
        error: {
          code: "PROJECT_COVER_BINDING_FAILED",
          message: unbound.error.message,
        },
      };
    }
  }
  presentation.set(COVER_BINDING_ID_KEY, binding.id);
  return { ok: true, coverAssetId: projectAssetId, changed: true };
}

/** Removes losing cover bindings after a multi-writer CRDT merge. */
export function reconcileProjectCoverBindings(doc: LoroDoc): {
  coverAssetId: string | null;
  unboundBindingIds: string[];
  changed: boolean;
} {
  const current = currentCoverBinding(doc);
  const presentation = doc.getMap(PROJECT_PRESENTATION_CONTAINER);
  let changed = false;
  if (!current && presentation.get(COVER_BINDING_ID_KEY) !== undefined) {
    presentation.delete(COVER_BINDING_ID_KEY);
    changed = true;
  }
  const unboundBindingIds: string[] = [];
  for (const binding of projectCoverBindings(doc)) {
    if (binding.id === current?.id) continue;
    const result = unbindActionAssetBinding(doc, binding.id);
    if (!result.ok) continue;
    unboundBindingIds.push(binding.id);
    changed = true;
  }
  return {
    coverAssetId: current?.projectAssetId ?? null,
    unboundBindingIds,
    changed,
  };
}
