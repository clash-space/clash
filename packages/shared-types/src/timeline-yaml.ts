/**
 * YAML projection of timelineDsl — the agent-facing surface.
 *
 * The Loro doc stores timelineDsl as a structured object (resolved absolute
 * frames in `from`, no expressions). Agent tools (read_timeline /
 * edit_timeline / write_timeline) round-trip that object through YAML so
 * agents can edit it like a config file with `prev`, `prev+15`, `clip-A-30`
 * style relative references.
 *
 * Module exports a small surface only:
 *   - timelineDslToYaml(dsl): string
 *   - timelineDslFromYaml(yaml): { ok: true, dsl } | { ok: false, error }
 *   - timelineDslHash(dsl): Promise<string>   (stale-read guard)
 *   - parseFromExpression / resolveFromExpression (exposed for tests)
 */
import { parse, stringify } from "yaml";

// ─── Types (loose; mirror the DSL shape used by the renderer) ────────

type RawItem = {
  id?: string;
  type?: string;
  from?: number | string;
  fromExpr?: string;
  durationInFrames?: number;
  [key: string]: unknown;
};

type RawTrack = {
  id?: string;
  name?: string;
  items?: RawItem[];
  hidden?: boolean;
  locked?: boolean;
  [key: string]: unknown;
};

type RawTimelineDsl = {
  tracks?: RawTrack[];
  compositionWidth?: number;
  compositionHeight?: number;
  fps?: number;
  durationInFrames?: number;
  [key: string]: unknown;
};

// The resolved DSL stored in Loro: from is a number, fromExpr optionally
// preserved alongside.
export type ResolvedItem = RawItem & { id: string; type: string; from: number; durationInFrames: number };
export type ResolvedTrack = { id: string; name?: string; items: ResolvedItem[]; hidden?: boolean; locked?: boolean };
export type ResolvedTimelineDsl = {
  tracks: ResolvedTrack[];
  compositionWidth?: number;
  compositionHeight?: number;
  fps?: number;
  durationInFrames?: number;
};

// ─── from-expression parser ──────────────────────────────────────────

export type FromExpression =
  | { kind: "absolute"; value: number }
  | { kind: "reference"; refId: string; offset: number };

// Two-step parse to avoid greedy-regex ambiguity. Naively allowing `-` in
// ids and as a negative-offset operator means "clip-A-15" can mean either
// "id literally `clip-A-15` with no offset" or "id `clip-A` minus 15". We
// resolve in favor of the offset form (more agent-friendly): try to match
// `<id><sign><number>$` non-greedy first, then fall back to a bare id.
//
// Convention agents must follow: don't end ids with `-<digits>`. Agents
// already use names like "clip-A", "title", "intro-1" — a leading dash with
// digits at the end is unambiguously an offset.
const OFFSET_RE = /^(.+?)\s*([+-])\s*([0-9]+(?:\.[0-9]+)?)$/;
const BARE_ID_RE = /^[A-Za-z0-9_.:-]+$/;

export function parseFromExpression(raw: unknown): FromExpression | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { kind: "absolute", value: Math.max(0, raw) };
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "start") return { kind: "absolute", value: 0 };
  // Numeric string ("30", "0", "30.5")
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return { kind: "absolute", value: Math.max(0, numeric) };
  }
  // <id><sign><number> form (preferred)
  const m = trimmed.match(OFFSET_RE);
  if (m) {
    const refId = (m[1] ?? "").trim();
    if (refId) {
      const sign = m[2] ?? "+";
      const offsetMag = parseFloat(m[3] ?? "0");
      const offset = Number.isFinite(offsetMag) ? (sign === "-" ? -offsetMag : offsetMag) : 0;
      return { kind: "reference", refId, offset };
    }
  }
  // Bare id, no offset
  if (BARE_ID_RE.test(trimmed)) {
    return { kind: "reference", refId: trimmed, offset: 0 };
  }
  return null;
}

type ResolutionTarget = {
  item: RawItem & { id: string; durationInFrames: number };
  trackItems: Array<RawItem & { id: string; durationInFrames: number }>;
  trackIndex: number; // index of this item within trackItems (for `prev`)
};

/**
 * Resolve an item's from-expression to an absolute frame number. Recurses
 * for chained references with cycle protection. Unresolvable references
 * (missing target, cycle, malformed) fall back to 0.
 */
export function resolveFromExpression(
  expr: FromExpression,
  target: ResolutionTarget,
  ctx: Map<string, ResolutionTarget>,
  visiting: Set<string> = new Set(),
  cache: Map<string, number> = new Map(),
): number {
  if (expr.kind === "absolute") return expr.value;

  // `prev`: previous item in the same track (by YAML order).
  if (expr.refId === "prev") {
    if (target.trackIndex <= 0) return Math.max(0, expr.offset);
    const prev = target.trackItems[target.trackIndex - 1];
    const prevFrom = resolveItemFrom(prev.id, ctx, visiting, cache);
    return Math.max(0, prevFrom + prev.durationInFrames + expr.offset);
  }

  const refTarget = ctx.get(expr.refId);
  if (!refTarget) return Math.max(0, expr.offset);

  const refFrom = resolveItemFrom(expr.refId, ctx, visiting, cache);
  return Math.max(0, refFrom + refTarget.item.durationInFrames + expr.offset);
}

function resolveItemFrom(
  itemId: string,
  ctx: Map<string, ResolutionTarget>,
  visiting: Set<string>,
  cache: Map<string, number>,
): number {
  const cached = cache.get(itemId);
  if (cached !== undefined) return cached;
  if (visiting.has(itemId)) return 0;
  const t = ctx.get(itemId);
  if (!t) return 0;
  visiting.add(itemId);
  try {
    const expr = parseFromExpression(t.item.from);
    if (!expr) {
      cache.set(itemId, 0);
      return 0;
    }
    const v = resolveFromExpression(expr, t, ctx, visiting, cache);
    cache.set(itemId, v);
    return v;
  } finally {
    visiting.delete(itemId);
  }
}

// ─── YAML serialization ──────────────────────────────────────────────

const ITEM_KEY_ORDER = ["id", "type", "from", "durationInFrames"];

/**
 * Serialize an item with stable key order: id → type → from → durationInFrames
 * → everything else. If `fromExpr` is set, it's collapsed into the `from`
 * field as a string (and fromExpr key is dropped from the output to avoid
 * duplication). Edits then operate purely on `from`.
 */
function itemToYamlObject(item: RawItem): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (item.id !== undefined) out.id = item.id;
  if (item.type !== undefined) out.type = item.type;
  // Collapse fromExpr → from as string.
  if (typeof item.fromExpr === "string" && item.fromExpr.length > 0) {
    out.from = item.fromExpr;
  } else if (item.from !== undefined) {
    out.from = item.from;
  }
  if (item.durationInFrames !== undefined) out.durationInFrames = item.durationInFrames;
  // Remaining keys, skipping the ones we already handled and the fromExpr memo.
  for (const [k, v] of Object.entries(item)) {
    if (ITEM_KEY_ORDER.includes(k) || k === "fromExpr") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function timelineDslToYaml(dsl: ResolvedTimelineDsl): string {
  const projected: Record<string, unknown> = {};
  if (dsl.compositionWidth !== undefined) projected.compositionWidth = dsl.compositionWidth;
  if (dsl.compositionHeight !== undefined) projected.compositionHeight = dsl.compositionHeight;
  if (dsl.fps !== undefined) projected.fps = dsl.fps;
  if (dsl.durationInFrames !== undefined) projected.durationInFrames = dsl.durationInFrames;
  projected.tracks = (dsl.tracks ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    ...(t.locked ? { locked: true } : {}),
    ...(t.hidden ? { hidden: true } : {}),
    items: (t.items ?? []).map((it) => itemToYamlObject(it)),
  }));
  // lineWidth: 0 disables line wrapping so Edit-tool string matching is reliable.
  return stringify(projected, { lineWidth: 0 });
}

// ─── YAML parsing + resolution ───────────────────────────────────────

export type FromYamlResult =
  | { ok: true; dsl: ResolvedTimelineDsl }
  | { ok: false; error: string };

export function timelineDslFromYaml(yamlText: string): FromYamlResult {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (e) {
    return { ok: false, error: `YAML parse error: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "YAML root must be a mapping (object)" };
  }
  const root = raw as RawTimelineDsl;
  if (!Array.isArray(root.tracks)) {
    return { ok: false, error: "Missing or invalid `tracks` array" };
  }

  // First pass: collect all items with their track context, validate basics.
  const ctx = new Map<string, ResolutionTarget>();
  const trackTargetsByTrack: ResolutionTarget[][] = [];
  for (const track of root.tracks) {
    if (!track || typeof track !== "object") {
      return { ok: false, error: "Each track must be an object" };
    }
    const items: RawItem[] = Array.isArray(track.items) ? (track.items as RawItem[]) : [];
    const trackTargets: ResolutionTarget[] = [];
    items.forEach((item, idx) => {
      if (!item || typeof item !== "object") return;
      if (typeof item.id !== "string" || item.id.length === 0) {
        return; // Will be caught below.
      }
      const dur = typeof item.durationInFrames === "number" ? item.durationInFrames : 0;
      const target: ResolutionTarget = {
        item: { ...item, id: item.id, durationInFrames: dur },
        trackItems: items as Array<RawItem & { id: string; durationInFrames: number }>,
        trackIndex: idx,
      };
      trackTargets.push(target);
      // First definition wins on duplicate id; report below.
      if (!ctx.has(item.id)) ctx.set(item.id, target);
    });
    trackTargetsByTrack.push(trackTargets);
  }

  // Validate: every item has id, type, durationInFrames.
  for (const track of root.tracks) {
    if (!Array.isArray(track.items)) continue;
    for (const item of track.items) {
      if (!item || typeof item !== "object") {
        return { ok: false, error: "Each item must be an object" };
      }
      if (typeof item.id !== "string" || item.id.length === 0) {
        return { ok: false, error: `Item is missing a string id: ${JSON.stringify(item).slice(0, 80)}` };
      }
      if (typeof item.type !== "string" || item.type.length === 0) {
        return { ok: false, error: `Item ${item.id} is missing type` };
      }
      if (typeof item.durationInFrames !== "number" || !Number.isFinite(item.durationInFrames) || item.durationInFrames < 0) {
        return { ok: false, error: `Item ${item.id} has invalid durationInFrames` };
      }
    }
  }

  // Second pass: resolve all from-expressions.
  const cache = new Map<string, number>();
  for (const target of ctx.values()) {
    resolveItemFrom(target.item.id, ctx, new Set(), cache);
  }

  // Third pass: build the resolved DSL with fromExpr preserved on items
  // whose `from` was a non-numeric expression.
  const resolvedTracks: ResolvedTrack[] = root.tracks.map((track, trackIdx) => {
    const items: ResolvedItem[] = (track.items ?? [])
      .filter((it): it is RawItem & { id: string; type: string; durationInFrames: number } =>
        Boolean(it) && typeof it.id === "string" && typeof it.type === "string" && typeof it.durationInFrames === "number",
      )
      .map((item) => {
        const resolved = cache.get(item.id) ?? 0;
        const isExpr = typeof item.from === "string" && parseFromExpression(item.from)?.kind === "reference";
        const out: ResolvedItem = {
          ...item,
          from: resolved,
        };
        if (isExpr && typeof item.from === "string") {
          out.fromExpr = item.from.trim();
        } else {
          // No expression — clear any stale fromExpr.
          delete out.fromExpr;
        }
        return out;
      });
    void trackTargetsByTrack[trackIdx]; // ensure trackIdx referenced
    return {
      id: typeof track.id === "string" ? track.id : `track-${trackIdx}`,
      name: typeof track.name === "string" ? track.name : undefined,
      items,
      hidden: track.hidden === true || undefined,
      locked: track.locked === true || undefined,
    };
  });

  const out: ResolvedTimelineDsl = {
    tracks: resolvedTracks,
  };
  if (typeof root.compositionWidth === "number") out.compositionWidth = root.compositionWidth;
  if (typeof root.compositionHeight === "number") out.compositionHeight = root.compositionHeight;
  if (typeof root.fps === "number") out.fps = root.fps;
  if (typeof root.durationInFrames === "number") out.durationInFrames = root.durationInFrames;
  return { ok: true, dsl: out };
}

// ─── Stable hash for stale-read detection ───────────────────────────

/**
 * Stable JSON serialization (sorted keys, omitting fromExpr — semantic
 * equivalence of the timeline shouldn't include the agent's authoring memo).
 * Used as input to SHA-256.
 */
function stableJsonForHash(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJsonForHash).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object)
      .filter((k) => k !== "fromExpr") // exclude memo
      .sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + stableJsonForHash((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

/**
 * Short hex fingerprint of the resolved timeline. Two reads return the same
 * hash iff the underlying timeline is semantically equivalent. Comparing
 * fromExpr strings is intentionally skipped — agent rewrites that change
 * only authoring style (e.g. `30` → `prev+0`) shouldn't trigger stale-read
 * rejections.
 */
export async function timelineDslHash(dsl: ResolvedTimelineDsl): Promise<string> {
  const stable = stableJsonForHash(dsl);
  const bytes = new TextEncoder().encode(stable);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
