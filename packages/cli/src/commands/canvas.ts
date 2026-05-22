import { Command } from "commander";
import WebSocket from "ws";
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  LoroSyncClient, Canvas,
  timelineDslToYaml, timelineDslFromYaml,
  type ResolvedTimelineDsl,
  parsePromptParts, extractAssetRefs,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";
import { isDaemonRunning, sendCommand, startDaemon, getSocketPath } from "../lib/daemon";
import { apiFetch, apiJson } from "../lib/api";

/**
 * Resolve the actor that's running this CLI invocation for Phase 0
 * attribution. There are two shapes:
 *
 *   - User-driven (default): the CLI was launched by a human with their
 *     own API token. Hit /api/v1/me to translate the token into a
 *     user id, then stamp `{actorType:'user', actorUserId:<user>}`.
 *   - Agent-driven: the CLI was launched by the bridge daemon as the
 *     subprocess of an ACP crew member. Bridge stamps
 *     CLASH_CREW_MEMBER_ID + CLASH_API_KEY into the env. The API token
 *     still resolves to the crew member's owner (because crew claims
 *     run under the user's bearer); we stamp `{actorType:'agent',
 *     actorAgentId:<cm>, actorUserId:<owner>}` so the resulting node
 *     attributes back to the human accountable for it.
 *
 * Both lookups go through the same /api/v1/me endpoint — agent-driven
 * just additionally carries the crew_member id from the env.
 */
async function resolveActor(): Promise<{ actorType: "user" | "agent"; actorUserId: string; actorAgentId?: string }> {
  const me = await apiJson<{ id: string }>("/api/v1/me").catch((e) => {
    throw new Error(`Failed to resolve user from API key: ${e instanceof Error ? e.message : String(e)}`);
  });
  const crewMemberId = process.env.CLASH_CREW_MEMBER_ID;
  if (crewMemberId) {
    return { actorType: "agent", actorUserId: me.id, actorAgentId: crewMemberId };
  }
  return { actorType: "user", actorUserId: me.id };
}

/**
 * Resolve project id from `--project` flag or fall back to env. Matches
 * the `clash room` convention so the canvas-editor crew (which has
 * CLASH_PROJECT_ID injected by the bridge daemon) doesn't have to
 * thread the id explicitly through every subcommand.
 *
 * Required by `timeline pull/push`; the older subcommands keep
 * `--project` as a hard requirement for back-compat.
 */
function resolveProjectId(opts: { project?: string }): string {
  if (opts.project) return opts.project;
  const env = process.env.CLASH_PROJECT_ID;
  if (env) return env;
  process.stderr.write(
    "error: project id is required.\n" +
      "Pass --project <id> or set CLASH_PROJECT_ID in the environment.\n",
  );
  process.exit(2);
}

/**
 * Create a one-shot connected LoroSyncClient (fallback when no daemon).
 */
async function connectToProject(projectId: string): Promise<LoroSyncClient> {
  const apiKey = requireApiKey();
  const serverUrl = getServerUrl();
  const wsUrl = serverUrl.replace(/^http/, "ws");

  const client = new LoroSyncClient({
    serverUrl: wsUrl,
    projectId,
    token: apiKey,
    clientType: "cli",
    WebSocket: WebSocket as any,
  });

  await client.connect();
  return client;
}

/**
 * Run a command via daemon if running, otherwise fall back to one-shot connection.
 */
async function runCommand(projectId: string, cmd: object): Promise<any> {
  if (isDaemonRunning(projectId)) {
    return sendCommand(projectId, cmd);
  }
  return null; // caller should fall back
}

export const canvasCommand = new Command("canvas")
  .description(`Canvas node operations (via Loro CRDT sync)

Node types: text, group, image, video, audio, image_gen, video_gen, audio_gen, text_gen

Daemon mode (recommended for multi-command sessions):
  clash canvas connect --project <id>     # start persistent connection
  clash canvas list --project <id> --json # uses daemon automatically
  clash canvas disconnect --project <id>  # stop (auto-exits after 10min idle)`);

// ─── connect ─────────────────────────────────────────────

canvasCommand
  .command("connect")
  .description("Start persistent connection to a project (daemon mode)")
  .requiredOption("--project <id>", "Project ID")
  .action(async (options) => {
    if (isDaemonRunning(options.project)) {
      console.log(JSON.stringify({ status: "already_running", socket: getSocketPath(options.project) }));
      return;
    }
    const apiKey = requireApiKey();
    const serverUrl = getServerUrl();
    await startDaemon(options.project, serverUrl, apiKey);
  });

// ─── disconnect ──────────────────────────────────────────

canvasCommand
  .command("disconnect")
  .description("Stop persistent connection")
  .requiredOption("--project <id>", "Project ID")
  .action(async (options) => {
    if (!isDaemonRunning(options.project)) {
      console.log("No daemon running.");
      return;
    }
    const result = await sendCommand(options.project, { action: "disconnect" });
    console.log(JSON.stringify(result));
  });

// ─── list ─────────────────────────────────────────────────

canvasCommand
  .command("list")
  .description("List canvas nodes")
  .requiredOption("--project <id>", "Project ID")
  .option("--type <type>", "Filter by node type")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const daemonResult = await runCommand(options.project, { action: "list", type: options.type });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult.nodes); }
      else {
        for (const node of daemonResult.nodes) {
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${(node.data?.label as string) || ""}`);
        }
        console.log(`\n${daemonResult.nodes.length} node(s)`);
      }
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const nodes = client.listNodes(options.type);
      if (isJsonMode(options)) {
        printJson(nodes);
      } else if (nodes.length === 0) {
        console.log("No nodes found.");
      } else {
        for (const node of nodes) {
          const label = (node.data.label as string) || "";
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${label}`);
        }
        console.log(`\n${nodes.length} node(s)`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── get ──────────────────────────────────────────────────

/** Cache dir: ~/.clash/cache/assets (cross-platform, persistent) */
const ASSET_CACHE_DIR = join(homedir(), ".clash", "cache", "assets");

/**
 * Download media asset by D1 asset id. Returns file path, or null on failure.
 *
 * Caches by assetId (immutable identifier — same id always means the same
 * underlying R2 object), so repeat calls skip the metadata round-trip
 * entirely. Extension is sniffed from srcR2Key the first time so file viewers
 * pick the right type.
 */
export async function downloadAssetById(assetId: string): Promise<string | null> {
  try {
    mkdirSync(ASSET_CACHE_DIR, { recursive: true });

    // Cache hit: any file starting with `${assetId}.` is the same asset.
    // Glob would be cleaner but readdirSync is dependency-free and fast for a tiny dir.
    const safeId = assetId.replace(/[/\\:]/g, "_");
    for (const name of readdirSync(ASSET_CACHE_DIR)) {
      if (name === safeId || name.startsWith(`${safeId}.`)) {
        return join(ASSET_CACHE_DIR, name);
      }
    }

    const metaRes = await apiFetch(`/api/v1/assets/${encodeURIComponent(assetId)}`);
    if (!metaRes.ok) return null;
    const asset = (await metaRes.json()) as { srcR2Key: string; signedUrl: string };

    const ext = asset.srcR2Key.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? "";
    const filePath = join(ASSET_CACHE_DIR, `${safeId}${ext}`);

    const fullUrl = `${getServerUrl()}${asset.signedUrl}`;
    const res = await fetch(fullUrl);
    if (!res.ok) return null;

    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    return filePath;
  } catch {
    return null;
  }
}

function printNodeInfo(n: any) {
  console.log(`ID:       ${n.id}`);
  console.log(`Type:     ${n.type}`);
  console.log(`Label:    ${(n.data?.label as string) || "(none)"}`);
  console.log(`Status:   ${(n.data?.status as string) || "(none)"}`);
  console.log(`Position: (${n.position.x}, ${n.position.y})`);
  if (n.data?.content) console.log(`Content:  ${n.data.content}`);
  if (n.data?.description) console.log(`Desc:     ${n.data.description}`);
}

canvasCommand
  .command("get")
  .description("Get a specific node. For media nodes, downloads the asset to a temp file.")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    let node: any = null;

    const daemonResult = await runCommand(options.project, { action: "get", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      node = daemonResult.node;
    } else {
      const client = await connectToProject(options.project);
      try {
        node = client.readNode(options.node);
        if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      } finally {
        await client.disconnect();
      }
    }

    // For media nodes, download the asset via D1 assetId.
    const assetId = typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
    const isMedia = ["image", "video", "audio"].includes(node.type);
    let assetPath: string | null = null;
    if (isMedia && assetId) {
      assetPath = await downloadAssetById(assetId);
    }

    if (isJsonMode(options)) {
      printJson({ ...node, ...(assetPath ? { assetPath } : {}) });
    } else {
      printNodeInfo(node);
      if (assetPath) {
        console.log(`Asset:    ${assetPath}`);
        console.log(`\nTo view this ${node.type}, open or read the file at the path above.`);
      }
    }
  });

// ─── add ──────────────────────────────────────────────────
//
// One unified surface for every kind of `*_gen` action-badge node (image,
// video, audio, text) plus plain text/group. The shape mirrors what the
// web UI persists on a fresh action-badge:
//
//   prompt        — text, supports inline `@[label](node:<id>)` references
//                   to canvas asset nodes (same syntax the chat composer
//                   emits). The mentions are *not* a separate input
//                   modality — the system partitions them by the
//                   referenced asset's `kind` (image / video / audio).
//   model         — modelId (--model). Defaults per node type if omitted.
//   modelParams   — model-specific knobs (--param k=v, repeatable). The
//                   model card validates which keys are accepted.
//   references    — explicit asset/node references (--ref, repeatable).
//                   Same partitioning as prompt mentions; useful when
//                   you want the ref WITHOUT cluttering the prompt text.
//
// Refs (both from --ref and from prompt @-mentions) are resolved at
// CLI submit time:
//   1. If the value looks like a canvas node id and the project's canvas
//      has that node, take `node.data.assetId`.
//   2. Otherwise assume it's already an asset id.
//   3. Fetch `/api/v1/assets/:id` for each to discover `kind`, then
//      partition into referenceImageAssetIds / referenceVideoAssetIds /
//      referenceAudioAssetIds.

/** Build the dash-form actionType + default modelId map for *_gen nodes.
 *  These have to match what the web UI's ActionBadge writes on create,
 *  otherwise the agent's nodes look "different" and the executor's
 *  provider-routing breaks. */
const ACTION_TYPE_BY_NODE_TYPE: Record<string, string> = {
  image_gen: "image-gen",
  video_gen: "video-gen",
  audio_gen: "audio-gen",
  text_gen: "text-gen",
};
const DEFAULT_MODEL_BY_NODE_TYPE: Record<string, string> = {
  image_gen: "gemini-flash-image",
  video_gen: "veo3-fast-text-to-video",
  audio_gen: "gemini-3.1-flash-tts",
  text_gen: "gemini-3-flash",
};

/** Parse a `--param k=v` value into a tuple. Numbers and booleans
 *  pass through as their primitive types; everything else stays a
 *  string. Mirrors the modelParams shape declared in shared-types
 *  (`Record<string, string | number | boolean>`). */
function coerceParamValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Only treat as number if the entire string is numeric. `"123abc"`
  // stays a string; agents pass strings like "16:9" that would
  // otherwise be lost to the parseFloat short-circuit.
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Resolve a list of `(nodeOrAssetIds)` to canvas node ids. References
 * on the canvas are expressed as **edges** — the web UI's ActionBadge
 * derives `refNodeIds` from incoming edges, not from any data field
 * the action-badge node carries. So the only thing we need from each
 * --ref or @-mention is the source node id; the kind partitioning
 * happens later, at execute time (`useSpawnPendingAsset.buildShape`),
 * when the pending asset node is being built and the model card is
 * known.
 *
 * Each input ref can be a canvas node id (kept as-is) or a bare asset
 * id (reverse-resolved by finding the node whose `data.assetId`
 * matches). Anything we can't resolve goes into `missing` so the CLI
 * can warn instead of silently dropping a reference.
 */
async function resolveReferences(
  projectId: string,
  refs: string[],
): Promise<{ refNodeIds: string[]; missing: string[] }> {
  const out = { refNodeIds: [] as string[], missing: [] as string[] };
  if (refs.length === 0) return out;

  // Cache the canvas listing once per `add` call. Daemon path is the
  // fast path; the one-shot LoroSyncClient fallback matters because
  // canvas daemons auto-exit after 10 minutes of idle — without it a
  // stale socket would silently drop every ref into `missing`.
  const nodesById = new Map<string, { id: string; data?: Record<string, unknown> }>();
  if (isDaemonRunning(projectId)) {
    const res = (await sendCommand(projectId, { action: "list" })) as
      | { nodes?: Array<{ id: string; data?: Record<string, unknown> }> }
      | null;
    for (const n of res?.nodes ?? []) nodesById.set(n.id, n);
  } else {
    const client = await connectToProject(projectId);
    try {
      for (const n of client.listNodes()) {
        nodesById.set(n.id, { id: n.id, data: n.data as Record<string, unknown> });
      }
    } finally {
      await client.disconnect();
    }
  }

  // Build a reverse index assetId → nodeId for the bare-asset-id path.
  const nodeIdByAssetId = new Map<string, string>();
  for (const [nid, n] of nodesById) {
    const aid = n.data?.assetId;
    if (typeof aid === "string") nodeIdByAssetId.set(aid, nid);
  }

  for (const ref of refs) {
    if (nodesById.has(ref)) {
      out.refNodeIds.push(ref);                       // direct node-id hit
    } else if (nodeIdByAssetId.has(ref)) {
      out.refNodeIds.push(nodeIdByAssetId.get(ref)!); // bare asset id → reverse-resolve
    } else {
      out.missing.push(ref);
    }
  }
  return out;
}

canvasCommand
  .command("add")
  .description("Add a text, group, or action-badge node")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--type <type>", "Node type: text, group, image_gen, video_gen, audio_gen, text_gen")
  .requiredOption("--label <label>", "Node label")
  .option("--prompt <text>", "Generation prompt for *_gen nodes. May contain `@[Label](node:<id>)` mentions to reference canvas asset nodes; type partitioning is automatic from the referenced asset's kind.")
  .option("--content <content>", "Body content for text / group nodes. Ignored for *_gen nodes — use --prompt there.")
  .option("--parent <id>", "Parent group ID")
  .option(
    "--model <id>",
    "Generation model id (e.g. gemini-flash-image, imagen-4-fast, veo3-fast-text-to-video). Stored as data.modelId. Required for *_gen action nodes when no marketplace action is installed.",
  )
  .option(
    "--ref <id...>",
    "Reference an existing canvas asset (image / video / audio). Accepts a canvas node id (we look up its asset) or a bare asset id. Repeatable; the type partitions automatically by asset kind.",
    (val: string, prev: string[]) => [...(prev ?? []), val],
    [] as string[],
  )
  .option(
    "--param <key=value...>",
    "Model parameter (repeatable, stored under data.modelParams). Booleans and integers are coerced; everything else stays a string. Example: --param aspectRatio=16:9 --param seed=42",
    (val: string, prev: Array<[string, string]>) => {
      const eq = val.indexOf("=");
      if (eq < 0) throw new Error(`--param expects key=value, got: ${val}`);
      return [...(prev ?? []), [val.slice(0, eq), val.slice(eq + 1)] as [string, string]];
    },
    [] as Array<[string, string]>,
  )
  .option(
    "--action <id>",
    "Use a custom marketplace action instead of a built-in model. The action must be registered in the project (via the Python SDK's register_custom_actions, or the marketplace install flow). When set, --model is ignored and --param values go into data.customActionParams instead of data.modelParams.",
  )
  .option("--json", "Output as JSON")
  .action(async (options) => {
    // Phase 0 attribution: every node landed via the CLI gets stamped
    // with the actor that's running it. NodeProcessor refuses to
    // dispatch generations without these fields, so they're mandatory
    // for *_gen nodes; we attach them to text / group nodes too so
    // the inspector can show "Made by X" uniformly.
    const actor = await resolveActor();
    const extraData: Record<string, unknown> = {
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      ...(actor.actorAgentId ? { actorAgentId: actor.actorAgentId } : {}),
    };
    const isGenNode = !!ACTION_TYPE_BY_NODE_TYPE[options.type];

    const isCustomAction = isGenNode && typeof options.action === "string" && options.action.length > 0;

    if (isGenNode) {
      if (isCustomAction) {
        // Custom action: actionType becomes `custom:<id>`, and the
        // executor reads customActionId / customActionParams / outputType
        // instead of modelId / modelParams. The output kind follows the
        // node type — `image_gen + --action grid-split` produces an
        // image-kinded pending child.
        extraData.actionType = `custom:${options.action}`;
        extraData.customActionId = options.action;
        const outputType =
          options.type === "video_gen" ? "video" :
          options.type === "audio_gen" ? "audio" :
          options.type === "text_gen"  ? "text"  : "image";
        extraData.outputType = outputType;
      } else {
        extraData.actionType = ACTION_TYPE_BY_NODE_TYPE[options.type];
        extraData.modelId = options.model ?? DEFAULT_MODEL_BY_NODE_TYPE[options.type];
      }
    } else if (options.model) {
      extraData.modelId = options.model;
    }

    // --param k=v lands under data.modelParams for built-in models, and
    // under data.customActionParams for custom actions. Both shapes are
    // `Record<string, string | number | boolean>`.
    if ((options.param ?? []).length > 0) {
      const params: Record<string, string | number | boolean> = {};
      for (const [k, v] of options.param) params[k] = coerceParamValue(v);
      if (isCustomAction) extraData.customActionParams = params;
      else extraData.modelParams = params;
    }

    // For *_gen nodes, write the prompt to BOTH `data.content` and
    // `data.prompt`. They map to different consumers in the web stack
    // and silently diverged on us once already:
    //   - ActionBadge's prompt editor seeds itself from `data.content`
    //     (the raw markdown the user typed, with `@[Label](node:id)`
    //     mentions preserved). Without it the UI renders an empty
    //     editor even when the node has a real prompt.
    //   - The generation executor reads `data.prompt` at run time as
    //     the cleaned plain-text payload to send to the provider.
    // The web UI keeps them in lockstep on every keystroke; we mirror
    // that here so CLI-created nodes are indistinguishable from
    // UI-created ones.
    const promptText: string | undefined = options.prompt;
    if (promptText && isGenNode) {
      extraData.prompt = promptText;
      extraData.content = promptText;
    }

    // Collect refs: explicit --ref values + any @-mentions inside the
    // prompt. Dedupe so a ref typed both ways doesn't get wired twice.
    const promptMentionIds = promptText
      ? extractAssetRefs(parsePromptParts(promptText)).map((r) => r.nodeId)
      : [];
    const allRefIds = [...new Set([...(options.ref ?? []), ...promptMentionIds])];

    // Resolve every input to a canvas node id. The action-badge data
    // doesn't carry the asset-id arrays (referenceImage/Video/AudioAssetIds);
    // those live on the *pending asset child* spawned at execute time
    // (see `useSpawnPendingAsset.buildShape` — it partitions refs by
    // model card capability at that moment). What the action-badge
    // does carry is `referenceImageOrder` — a positional list of
    // source node ids that the web UI uses to render the inline ref
    // chips inside the prompt editor in a stable order. The actual
    // ref edges are the source of truth, mirroring how the web
    // creates them (ActionBadge.addRefNode does the same).
    let refNodeIds: string[] = [];
    if (isGenNode && allRefIds.length > 0) {
      const resolved = await resolveReferences(options.project, allRefIds);
      refNodeIds = resolved.refNodeIds;
      if (refNodeIds.length > 0) extraData.referenceImageOrder = refNodeIds;
      if (resolved.missing.length > 0 && !isJsonMode(options)) {
        console.error(
          `warning: ${resolved.missing.length} reference(s) couldn't be resolved (no canvas node or asset row found): ${resolved.missing.join(", ")}`,
        );
      }
    }

    // For non-*_gen nodes (text / group) the daemon's `add` handler
    // sets `data.content` from this top-level field. For *_gen nodes
    // we've already populated data.content from --prompt above, so
    // don't double-write.
    const daemonResult = await runCommand(options.project, {
      action: "add", type: options.type, label: options.label,
      content: isGenNode ? undefined : options.content,
      parentId: options.parent,
      data: Object.keys(extraData).length ? extraData : undefined,
    });

    /** After the node lands, wire each ref through `ensure_edge` (daemon)
     *  or directly via the LoroSyncClient. Each edge fans out via
     *  Loro to every connected browser, where ActionBadge's
     *  `refNodeIds` recomputes from `edges.filter(e => e.target === id)`
     *  and the prompt editor's mention chips resolve their thumbnails. */
    async function wireRefEdges(newNodeId: string): Promise<void> {
      if (refNodeIds.length === 0) return;
      if (isDaemonRunning(options.project)) {
        for (const sourceId of refNodeIds) {
          await sendCommand(options.project, { action: "ensure_edge", source: sourceId, target: newNodeId });
        }
        return;
      }
      // No daemon — open a one-shot client. Note: this path means we
      // open *two* clients in the no-daemon code branch (one here, one
      // in the createNode fallback below), each with its own connect /
      // disconnect. Not ideal but matches the existing one-shot pattern
      // elsewhere in this file. Daemon mode (recommended) avoids it.
      const client = await connectToProject(options.project);
      try {
        const existing = client.canvas.listEdges();
        for (const sourceId of refNodeIds) {
          const dup = existing.find((e) => e.source === sourceId && e.target === newNodeId);
          if (dup) continue;
          client.canvas.insertEdge(`${sourceId}-${newNodeId}`, sourceId, newNodeId, "default");
        }
      } finally {
        await client.disconnect();
      }
    }

    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      await wireRefEdges(daemonResult.node_id as string);
      if (isJsonMode(options)) { printJson({ ...daemonResult, refNodeIds }); }
      else {
        console.log(`Created node: ${daemonResult.node_id} (${options.type})`);
        if (daemonResult.asset_id) console.log(`Asset ID:    ${daemonResult.asset_id}`);
        if (refNodeIds.length > 0) console.log(`Refs wired:  ${refNodeIds.join(", ")}`);
      }
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const nodeId = crypto.randomUUID().slice(0, 8);
      const data: Record<string, unknown> = { ...extraData, label: options.label };
      if (options.content && !isGenNode) { data.content = options.content; }

      const result = client.createNode(nodeId, options.type, data, null, options.parent ?? null);
      const existing = client.canvas.listEdges();
      for (const sourceId of refNodeIds) {
        const dup = existing.find((e) => e.source === sourceId && e.target === nodeId);
        if (dup) continue;
        client.canvas.insertEdge(`${sourceId}-${nodeId}`, sourceId, nodeId, "default");
      }
      if (isJsonMode(options)) {
        printJson({ ...result, refNodeIds });
      } else {
        console.log(`Created node: ${result.node_id} (${options.type})`);
        if (result.asset_id) console.log(`Asset ID:    ${result.asset_id}`);
        if (refNodeIds.length > 0) console.log(`Refs wired:  ${refNodeIds.join(", ")}`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── execute ──────────────────────────────────────────────

canvasCommand
  .command("execute")
  .description(
    "Execute a node — triggers generation for action-badge nodes or render for video-editor nodes",
  )
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID (action-badge or video-editor)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const printExecuteResult = (kind: string | null, childNodeId: string, childNodeType: string) => {
      if (kind === "render") {
        console.log(`Executed video-editor: ${options.node}`);
        console.log(`Created pending render-video node: ${childNodeId}`);
      } else {
        console.log(`Executed action-badge: ${options.node}`);
        console.log(`Created pending asset: ${childNodeId} (${childNodeType})`);
      }
    };

    const daemonResult = await runCommand(options.project, { action: "execute", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) printJson(daemonResult);
      else printExecuteResult(daemonResult.kind, daemonResult.childNodeId, daemonResult.childNodeType);
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const canvas = new Canvas(client.doc, () => {});
      const r = canvas.execute(options.node, () => crypto.randomUUID().slice(0, 8));
      if (r.error) { console.error(`Error: ${r.error}`); process.exit(1); }
      if (isJsonMode(options)) {
        printJson({ executed: true, kind: r.kind, childNodeId: r.childNodeId, childNodeType: r.childNodeType });
      } else {
        printExecuteResult(r.kind, r.childNodeId, r.childNodeType);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── timeline (pull / push) ───────────────────────────────
//
// VideoEditorNode owns a `timelineDsl` blob under `node.data.timelineDsl`
// (tracks + fps + composition size + duration; shape defined in
// `@master-clash/remotion-core` as `TimelineDsl`). The agent (canvas-editor
// crew) edits videos by:
//   1. `clash canvas timeline pull --node <id> -o timeline.yaml`
//   2. opening timeline.yaml in their Read/Edit toolchain
//   3. `clash canvas timeline push --node <id> -i timeline.yaml`
//
// YAML, not JSON: matches the agent-facing format defined in
// `@clash/shared-types/timeline-yaml` (`timelineDsl{To,From}Yaml`). That
// module already implements the full validator + relative-position
// resolver ("prev", "prev+15", "clip-A-30") used by the in-app
// agent tools, so the CLI just delegates. Keeps the agent surface and
// the in-app surface byte-identical instead of inventing a parallel
// JSON dialect that drifts.

const timelineCommand = canvasCommand
  .command("timeline")
  .description(
    `Round-trip a VideoEditorNode's timeline as a YAML file (edit-on-disk).

Workflow:
  clash canvas timeline pull --node <id> -o timeline.yaml   # export
  # edit timeline.yaml with your normal Read/Edit tools
  clash canvas timeline push --node <id> -i timeline.yaml   # write back

Shape (one track, two image clips back-to-back):
  compositionWidth: 1920
  compositionHeight: 1080
  fps: 30
  durationInFrames: 300
  tracks:
    - id: track-1
      name: Video
      items:
        - id: shot-A
          type: image
          from: 0
          durationInFrames: 150
          sourceNodeId: abc12345
        - id: shot-B
          type: image
          from: prev          # = previous item's end
          durationInFrames: 150
          sourceNodeId: def67890

\`from\` accepts numbers (absolute frame), the literal "prev" (the
previous item on the same track), or "<id>±N" (offset from another
item's end). All resolved to absolute frames on push. \`sourceNodeId\`
points at a canvas asset node — find candidates with
\`clash canvas list --type image --json\`.`,
  );

// ─── timeline pull ─────────────────────────────────────────

timelineCommand
  .command("pull")
  .description("Export the node's timelineDsl as YAML to stdout or a file")
  .requiredOption("--node <id>", "VideoEditorNode ID")
  .option("--project <id>", "Project ID (defaults to $CLASH_PROJECT_ID)")
  .option("-o, --output <path>", "Write to this file instead of stdout")
  .action(async (options) => {
    const projectId = resolveProjectId(options);
    const node = await readNode(projectId, options.node);
    if (!node) {
      console.error(`Node not found: ${options.node}`);
      process.exit(1);
    }
    if (node.type !== "video-editor") {
      // Soft warning, not a hard error — power users might keep timeline
      // blobs on non-editor nodes during migrations. Surface it loudly so
      // crew agents notice and pick a different node.
      process.stderr.write(
        `warning: node ${options.node} has type "${node.type}", expected "video-editor". ` +
          `Proceeding; the editor may ignore the result.\n`,
      );
    }

    // Materialize a ResolvedTimelineDsl for the YAML serializer. Items
    // read from Loro might have one of three shapes:
    //   - canonical: `from` + `durationInFrames`         (current)
    //   - half-legacy: `start_at` + `duration_in_frames` (snake; editor
    //     already migrates this at openEditor)
    //   - earlier-wrong: `start` + `end` + `trackId`     (what a
    //     previous version of THIS skill mistakenly taught)
    // We normalize all three before serializing so the YAML the agent
    // sees is always the canonical shape — `start`/`end`/`trackId`
    // never leak into agent-visible files.
    const dsl = normalizeForPull((node.data as Record<string, unknown> | undefined)?.timelineDsl);
    const yaml = timelineDslToYaml(dsl);

    if (options.output) {
      writeFileSync(options.output, yaml, "utf-8");
      process.stderr.write(`wrote ${options.output}\n`);
    } else {
      process.stdout.write(yaml);
    }
  });

// ─── timeline push ─────────────────────────────────────────

timelineCommand
  .command("push")
  .description("Write a timelineDsl YAML file back into the node")
  .requiredOption("--node <id>", "VideoEditorNode ID")
  .option("--project <id>", "Project ID (defaults to $CLASH_PROJECT_ID)")
  .option("-i, --input <path>", "Read from this file (default: stdin, or '-' for stdin)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = resolveProjectId(options);

    // Read body. `-i -` and omitting `-i` both read stdin; `-i <path>` reads file.
    const raw = readBody(options.input);
    // Validate + resolve via the shared parser. Catches: bad YAML, missing
    // `tracks`, items without id/type/durationInFrames, items typoed with
    // `start`/`end` instead of `from`/`durationInFrames` (those fail the
    // durationInFrames check), and resolves `prev` / `<id>±N` references
    // to absolute frames.
    const result = timelineDslFromYaml(raw);
    if (!result.ok) {
      console.error(`error: ${result.error}`);
      process.exit(1);
    }
    const resolved = result.dsl;

    // Each unique source media node in the timeline gets a default
    // canvas edge to the editor — so the graph view reflects "this
    // editor consumes these media nodes" instead of looking like a
    // floating island. ensure_edge is idempotent on (source, target).
    const sources = sourceNodeIdsFromResolved(resolved);

    // Daemon path: existing `update` action merges `data` into node.data
    // and broadcasts to the project room. timelineDsl is just one of
    // those merged fields — same wire shape as `clash canvas update`.
    const daemonResult = await runCommand(projectId, {
      action: "update",
      nodeId: options.node,
      data: { timelineDsl: resolved },
    });
    if (daemonResult) {
      if (daemonResult.error) {
        console.error(daemonResult.error);
        process.exit(1);
      }
      let edgesAdded = 0;
      for (const src of sources) {
        const r = await runCommand(projectId, {
          action: "ensure_edge",
          source: src,
          target: options.node,
        });
        if (r && !r.error && r.existed === false) edgesAdded++;
      }
      if (isJsonMode(options)) printJson({ ...daemonResult, edgesAdded, sources });
      else
        process.stderr.write(
          `pushed timeline to ${options.node} (${sources.length} source${sources.length === 1 ? "" : "s"}, +${edgesAdded} edge${edgesAdded === 1 ? "" : "s"})\n`,
        );
      return;
    }

    // One-shot fallback (no daemon connected for this project).
    const client = await connectToProject(projectId);
    try {
      const ok = client.updateNode(options.node, { timelineDsl: resolved });
      if (!ok) {
        console.error(`Node not found: ${options.node}`);
        process.exit(1);
      }
      let edgesAdded = 0;
      const existing = client.canvas.listEdges();
      for (const src of sources) {
        const pair = existing.find((e) => e.source === src && e.target === options.node);
        if (pair) continue;
        const edgeId = `e-${src}-${options.node}-${crypto.randomUUID().slice(0, 4)}`;
        client.canvas.insertEdge(edgeId, src, options.node, "default");
        edgesAdded++;
      }
      if (isJsonMode(options)) printJson({ updated: true, nodeId: options.node, edgesAdded, sources });
      else
        process.stderr.write(
          `pushed timeline to ${options.node} (${sources.length} source${sources.length === 1 ? "" : "s"}, +${edgesAdded} edge${edgesAdded === 1 ? "" : "s"})\n`,
        );
    } finally {
      await client.disconnect();
    }
  });

/**
 * Read a `data.timelineDsl` value out of Loro and coerce it into a shape
 * `timelineDslToYaml` is willing to serialize. We accept three input
 * shapes because real-world projects have all of them:
 *
 *   1. Canonical (current editor + this CLI's push):
 *      `{ from: number, durationInFrames: number }`
 *   2. Snake legacy (older backend dumps):
 *      `{ start_at: number, duration_in_frames: number }`
 *   3. start/end legacy (a buggy version of *this skill* wrote this,
 *      plus the in-editor `properties` block that gets added on save).
 *      `{ start: number, end: number, trackId: string, properties: {...} }`
 *
 * Migration here is best-effort. The serializer downstream still
 * validates — anything that can't be migrated (e.g. missing both `from`
 * and `start`) will round-trip as 0/0 and the agent will see it in the
 * YAML and notice.
 */
function normalizeForPull(raw: unknown): ResolvedTimelineDsl {
  const skeleton: ResolvedTimelineDsl = {
    tracks: [],
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 300,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return skeleton;
  const o = raw as Record<string, unknown>;
  const tracks = Array.isArray(o.tracks) ? o.tracks : [];
  const outTracks = tracks.map((t, ti) => {
    const tr = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const items = Array.isArray(tr.items) ? tr.items : [];
    const outItems = items
      .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === "object")
      .map((it) => normalizeItemForPull(it));
    return {
      id: typeof tr.id === "string" ? tr.id : `track-${ti}`,
      name: typeof tr.name === "string" ? tr.name : undefined,
      hidden: tr.hidden === true || undefined,
      locked: tr.locked === true || undefined,
      items: outItems,
    };
  });
  return {
    tracks: outTracks,
    compositionWidth: typeof o.compositionWidth === "number" ? o.compositionWidth : skeleton.compositionWidth,
    compositionHeight: typeof o.compositionHeight === "number" ? o.compositionHeight : skeleton.compositionHeight,
    fps: typeof o.fps === "number" ? o.fps : skeleton.fps,
    durationInFrames: typeof o.durationInFrames === "number" ? o.durationInFrames : skeleton.durationInFrames,
  };
}

function normalizeItemForPull(it: Record<string, unknown>): {
  id: string;
  type: string;
  from: number;
  durationInFrames: number;
  [k: string]: unknown;
} {
  // from: prefer canonical, fall back to snake then to start.
  let from: number;
  if (typeof it.from === "number") from = it.from;
  else if (typeof it.start_at === "number") from = it.start_at;
  else if (typeof it.start === "number") from = it.start;
  else from = 0;

  // durationInFrames: canonical, snake, or (end - start) reconstruction.
  let durationInFrames: number;
  if (typeof it.durationInFrames === "number") durationInFrames = it.durationInFrames;
  else if (typeof it.duration_in_frames === "number") durationInFrames = it.duration_in_frames;
  else if (typeof it.end === "number" && typeof it.start === "number") durationInFrames = Math.max(0, it.end - it.start);
  else durationInFrames = 0;

  const id = typeof it.id === "string" && it.id.length > 0 ? it.id : `item-${Math.random().toString(36).slice(2, 8)}`;
  const type = typeof it.type === "string" ? it.type : "image";

  // Pass through everything else (sourceNodeId, assetId, src, properties,
  // type-specific fields like fadeIn/Out, transitions etc.) except the
  // keys we just folded into `from`/`durationInFrames`. Keeping
  // `properties` is fine — it's user-positioning data the editor reads
  // back on open.
  const drop = new Set(["from", "durationInFrames", "start", "end", "start_at", "duration_in_frames", "trackId", "id", "type"]);
  const passthrough: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(it)) {
    if (drop.has(k)) continue;
    if (v === undefined) continue;
    passthrough[k] = v;
  }

  return { id, type, from, durationInFrames, ...passthrough };
}

/**
 * Walk a resolved DSL's items and return every unique sourceNodeId.
 * Used by `timeline push` to materialize matching canvas edges.
 */
function sourceNodeIdsFromResolved(dsl: ResolvedTimelineDsl): string[] {
  const seen = new Set<string>();
  for (const track of dsl.tracks ?? []) {
    for (const item of track.items ?? []) {
      const sid = (item as Record<string, unknown>).sourceNodeId;
      if (typeof sid === "string" && sid.length > 0) seen.add(sid);
    }
  }
  return Array.from(seen);
}

/** Read input from a path, "-" (stdin), or stdin when unspecified. */
function readBody(input?: string): string {
  if (!input || input === "-") return readFileSync(0, "utf-8");
  return readFileSync(input, "utf-8");
}

/** Read one node via daemon if possible, otherwise one-shot LoroSync. */
async function readNode(
  projectId: string,
  nodeId: string,
): Promise<{ type: string; data: Record<string, unknown> } | null> {
  const daemonResult = await runCommand(projectId, { action: "get", nodeId });
  if (daemonResult) {
    if (daemonResult.error) return null;
    return daemonResult.node ?? null;
  }
  const client = await connectToProject(projectId);
  try {
    const node = client.readNode(nodeId);
    return node ? { type: node.type, data: node.data as Record<string, unknown> } : null;
  } finally {
    await client.disconnect();
  }
}

// ─── update ───────────────────────────────────────────────

canvasCommand
  .command("update")
  .description("Update a node's data")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID")
  .option("--label <label>", "New label")
  .option("--content <content>", "New content")
  .option("--asset-id <id>", "Bind an existing asset (image/video/audio) to this node — its preview will render")
  .option(
    "--data <key=value...>",
    "Arbitrary node-data field (repeatable). Example: --data status=completed --data description='hello'",
    (val: string, prev: Array<[string, string]>) => {
      const eq = val.indexOf("=");
      if (eq < 0) throw new Error(`--data expects key=value, got: ${val}`);
      return [...(prev ?? []), [val.slice(0, eq), val.slice(eq + 1)] as [string, string]];
    },
    [] as Array<[string, string]>,
  )
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const extraData: Record<string, unknown> = {};
    if (options.assetId) extraData.assetId = options.assetId;
    for (const [k, v] of (options.data ?? [])) extraData[k] = v;

    const daemonResult = await runCommand(options.project, {
      action: "update",
      nodeId: options.node,
      label: options.label,
      content: options.content,
      data: Object.keys(extraData).length ? extraData : undefined,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else console.log(`Updated node: ${options.node}`);
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const updates: Record<string, unknown> = { ...extraData };
      if (options.label) updates.label = options.label;
      if (options.content) updates.content = options.content;
      if (Object.keys(updates).length === 0) {
        console.error("Provide at least one field to update (--label, --content, --asset-id, --data k=v)");
        process.exit(1);
      }
      const ok = client.updateNode(options.node, updates);
      if (!ok) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      if (isJsonMode(options)) printJson({ updated: true, nodeId: options.node });
      else console.log(`Updated node: ${options.node}`);
    } finally {
      await client.disconnect();
    }
  });

// ─── delete ───────────────────────────────────────────────

canvasCommand
  .command("delete")
  .description("Delete a node")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const daemonResult = await runCommand(options.project, { action: "delete", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else console.log(`Deleted node: ${options.node}`);
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const ok = client.deleteNode(options.node);
      if (!ok) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      if (isJsonMode(options)) printJson({ deleted: true, nodeId: options.node });
      else console.log(`Deleted node: ${options.node}`);
    } finally {
      await client.disconnect();
    }
  });

// ─── search ───────────────────────────────────────────────

canvasCommand
  .command("search")
  .description("Search nodes by content")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--query <query>", "Search query")
  .option("--type <types>", "Comma-separated node types to filter")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const daemonResult = await runCommand(options.project, {
      action: "search", query: options.query, types: options.type?.split(",") ?? null,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult.nodes); }
      else {
        for (const node of daemonResult.nodes) {
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${(node.data?.label as string) || ""}`);
        }
        console.log(`\n${daemonResult.nodes.length} result(s)`);
      }
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const nodeTypes = options.type?.split(",") ?? null;
      const nodes = client.searchNodes(options.query, nodeTypes);
      if (isJsonMode(options)) {
        printJson(nodes);
      } else if (nodes.length === 0) {
        console.log(`No nodes matching '${options.query}'.`);
      } else {
        for (const node of nodes) {
          const label = (node.data.label as string) || "";
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${label}`);
        }
        console.log(`\n${nodes.length} result(s)`);
      }
    } finally {
      await client.disconnect();
    }
  });
