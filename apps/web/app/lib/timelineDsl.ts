/**
 * Timeline DSL normalization helpers.
 *
 * Persistence contract: items stored in Loro carry `item.sourceNodeId`
 * (the canvas node that owns the media) and, when known, `item.assetId`
 * (the D1 asset row id, matching canvas node data.assetId). Concrete src /
 * type / dimensions are resolved at editor-open time from the canvas node
 * and asset row, not persisted in the timeline.
 *
 * These helpers handle:
 *  - legacy data migration (items that only have `src`, or whose `assetId`
 *    still points at a canvas source node)
 *  - final enforcement (strip `src` on save)
 *
 * Kept framework-free and side-effect free so both React Flow node
 * components (VideoEditorNode) and the editor provider (VideoEditorContext)
 * can call them without entangling lifecycles.
 */

import {
  getItemSourceNodeId,
  type Track,
  type Item,
} from "@clash/remotion-core";
import type { Node } from "@xyflow/react";

/** Known prefixes the asset routes are mounted under — used to recover a raw
 *  R2 key from a legacy persisted URL. */
const ASSET_URL_PREFIXES = ["/assets/", "/api/assets/view/", "/api/assets/"];

function urlPathnameFromSrc(src: string): string | null {
  if (
    !src.startsWith("/") &&
    !src.startsWith("http://") &&
    !src.startsWith("https://")
  ) {
    return null;
  }
  try {
    const u = src.startsWith("http")
      ? new URL(src)
      : new URL(src, "http://placeholder.local");
    return u.pathname;
  } catch {
    return null;
  }
}

/** Best-effort: given an item `src` (possibly a legacy signed URL), return
 *  the raw R2 key so the canvas can match it against `node.data.src`. */
export function srcToR2Key(src: string): string {
  if (!src) return src;
  const pathname = urlPathnameFromSrc(src);
  if (pathname === null) return src; // already a bare key
  for (const prefix of ASSET_URL_PREFIXES) {
    if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  }
  return src;
}

/**
 * Back-fill explicit `sourceNodeId` and real asset-row `assetId` on legacy
 * items. Old timelines stored the canvas source node in `item.assetId`; new
 * timelines store that as `sourceNodeId` and keep `assetId` aligned with
 * ActionBadge / media nodes (`node.data.assetId`).
 *
 * Idempotent — items that already have `sourceNodeId` keep it and only fill
 * `assetId` from the source node when possible.
 */
export function hydrateAssetIdsFromNodes(
  tracks: Track[],
  nodes: Node[],
): Track[] {
  const srcToNodeId = new Map<string, string>();
  const nodeById = new Map<string, Node>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
    const s = (n.data as Record<string, unknown> | undefined)?.src;
    if (typeof s === "string" && s && !srcToNodeId.has(s)) {
      srcToNodeId.set(s, n.id);
    }
  }
  return tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      let sourceNodeId = item.sourceNodeId;

      if (!sourceNodeId && item.assetId && nodeById.has(item.assetId)) {
        sourceNodeId = item.assetId;
      }

      if (!sourceNodeId) {
        const legacySrc = (item as Item & { src?: string }).src;
        if (typeof legacySrc === "string") {
          const key = srcToR2Key(legacySrc);
          sourceNodeId = srcToNodeId.get(key) ?? srcToNodeId.get(legacySrc);
        }
      }

      if (!sourceNodeId) {
        return item;
      }

      const sourceNode = nodeById.get(sourceNodeId);
      const projectAssetId =
        typeof sourceNode?.data?.assetId === "string"
          ? sourceNode.data.assetId
          : item.sourceNodeId
            ? item.assetId
            : undefined;

      return {
        ...item,
        sourceNodeId,
        ...(projectAssetId ? { assetId: projectAssetId } : {}),
      } as Item;
    }),
  }));
}

/**
 * Strip `src` from every item. Used both on save (persist reference-only)
 * and on load after hydration (so stale signed URLs can't leak into the
 * render path even if hydration couldn't fully migrate them).
 */
export function stripSrcFromTracks(tracks: Track[]): Track[] {
  return tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      const sourceNodeId = getItemSourceNodeId(item);
      const {
        src: _src,
        justInserted: _justInserted,
        ...rest
      } = item as Item & {
        src?: string;
        justInserted?: boolean;
      };
      return {
        ...rest,
        ...(sourceNodeId ? { sourceNodeId } : {}),
      } as Item;
    }),
  }));
}
