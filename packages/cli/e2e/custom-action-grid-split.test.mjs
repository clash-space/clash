/**
 * End-to-end test: local custom-action grid-split produces N sibling
 * image nodes from one input.
 *
 * Scope: exercises the multi-output protocol end-to-end —
 *   1. Python agent registers `grid-split` via WebSocket.
 *   2. CLI creates a `custom:grid-split` action-badge wired to an
 *      existing image (the 2x2 grid we generated upstream).
 *   3. NodeProcessor dispatches the task to the agent over JSON
 *      sideband (custom_task_assigned).
 *   4. Agent fetches the image, slices it, uploads 4 outputs, sends
 *      `complete_custom_task` with `result.assets: [4 entries]`.
 *   5. ProjectRoom lands tile-1 on the pending child and spawns
 *      3 sibling image nodes via Canvas.createLinkedNode, each
 *      sharing the action-badge as upstream lineage.
 *
 * Regression scope: the original single-output protocol silently
 * dropped outputs 2..N. This test asserts that all 4 tiles surface
 * on the canvas with distinct asset ids and `status: 'completed'`.
 *
 * Prereqs (test self-skips if any are missing):
 *   - CLASH_API_KEY + CLASH_API_URL exported
 *   - CLASH_TEST_PROJECT_ID points at a project with at least one
 *     image asset on the canvas (preferably a recognisable grid)
 *   - CLASH_TEST_GRID_NODE_ID — the canvas node id of the grid image
 *     to slice. If unset we pick the first available image asset.
 *   - Python venv with clash-sdk + pillow + aiohttp installed at
 *     `.venv/` (one dir up from the repo root, i.e. `<repo>/.venv`).
 *
 * Run:
 *   pnpm --filter @clash-space/cli build
 *   node packages/cli/e2e/custom-action-grid-split.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const CLI = join(__dirname, "..", "dist", "index.js");
const PY = join(REPO_ROOT, ".venv", "bin", "python");
const GRID_SPLIT_PY = join(REPO_ROOT, "packages", "clash-sdk", "python", "examples", "grid_split.py");

const PROJECT_ID = process.env.CLASH_TEST_PROJECT_ID;
const HAVE_AUTH = !!(process.env.CLASH_API_KEY && process.env.CLASH_API_URL);
const SERVER_URL = process.env.CLASH_API_URL ?? "";
const SYNC_URL = SERVER_URL.replace(/^http/, "ws"); // http(s)://x → ws(s)://x

const skipReason =
  !PROJECT_ID
    ? "CLASH_TEST_PROJECT_ID not set"
    : !HAVE_AUTH
      ? "CLASH_API_KEY / CLASH_API_URL not set"
      : false;

function clash(args) {
  const result = spawnSync("node", [CLI, ...args, "--json"], {
    encoding: "utf-8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `clash ${args.join(" ")} exited ${result.status}\nstdout:${result.stdout}\nstderr:${result.stderr}`,
    );
  }
  const trimmed = result.stdout.trim();
  return trimmed.startsWith("[") || trimmed.startsWith("{")
    ? JSON.parse(trimmed)
    : trimmed;
}

function pickGridImageNode() {
  if (process.env.CLASH_TEST_GRID_NODE_ID) {
    return { nodeId: process.env.CLASH_TEST_GRID_NODE_ID };
  }
  const list = clash(["canvas", "list", "--project", PROJECT_ID, "--type", "image"]);
  const node = (list ?? []).find(
    (n) => typeof n?.data?.assetId === "string" && n.data.status !== "pending",
  );
  if (!node) {
    throw new Error(
      "no image node with assetId on canvas; either generate a 2x2 grid in the UI first " +
      "or set CLASH_TEST_GRID_NODE_ID to point at the grid image.",
    );
  }
  return { nodeId: node.id };
}

/** Spawn the python grid_split agent. Returns the child process so we
 *  can SIGTERM it during teardown. The agent registers `grid-split`
 *  with the project and starts watching for `custom_task_assigned`. */
function spawnGridSplitAgent() {
  const env = {
    ...process.env,
    CLASH_SERVER_URL: SYNC_URL,
    CLASH_PROJECT_ID: PROJECT_ID,
    CLASH_API_KEY: process.env.CLASH_API_KEY,
  };
  const child = spawn(PY, [GRID_SPLIT_PY], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => process.stderr.write(`[agent] ${b}`));
  child.stderr.on("data", (b) => process.stderr.write(`[agent-err] ${b}`));
  return child;
}

async function waitForAgentReady(maxMs = 8000) {
  // Hacky readiness signal: poll customActions until grid-split shows
  // up. The agent registers within ~1s of starting up.
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const actions = clash(["canvas", "actions", "list", "--project", PROJECT_ID]);
      if (Array.isArray(actions) && actions.some((a) => a.id === "grid-split")) return;
    } catch {
      // CLI may not have a `canvas actions list` subcommand — fall
      // back to a fixed delay below.
    }
    await sleep(500);
  }
  // No reliable check; give the agent a few seconds and hope.
  await sleep(2000);
}

async function waitForCompletion(nodeId, maxMs = 30_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const node = clash(["canvas", "get", "--project", PROJECT_ID, "--node", nodeId]);
    const status = node?.data?.status;
    if (status === "completed" || status === "failed") return node;
    await sleep(750);
  }
  throw new Error(`node ${nodeId} did not complete within ${maxMs}ms`);
}

test("local custom action grid-split spawns 4 sibling image nodes (2x2)", { skip: skipReason }, async (t) => {
  const grid = pickGridImageNode();
  const agent = spawnGridSplitAgent();
  let badgeId = null;
  let primaryChildId = null;
  const createdNodeIds = [];

  t.after(async () => {
    if (badgeId) {
      try { clash(["canvas", "delete", "--project", PROJECT_ID, "--node", badgeId]); } catch {}
    }
    for (const id of createdNodeIds) {
      try { clash(["canvas", "delete", "--project", PROJECT_ID, "--node", id]); } catch {}
    }
    if (!agent.killed) agent.kill("SIGTERM");
  });

  await waitForAgentReady();

  // Create the action-badge wired to the grid image as a reference.
  const created = clash([
    "canvas", "add",
    "--project", PROJECT_ID,
    "--type", "image_gen",
    "--label", "e2e-grid-split",
    "--action", "grid-split",
    "--ref", grid.nodeId,
    "--param", "grid_size=2x2",
  ]);
  badgeId = created.node_id;
  createdNodeIds.push(badgeId);

  // Spawn the pending child (mirrors what the UI's Run does).
  const pending = clash([
    "canvas", "execute",
    "--project", PROJECT_ID,
    "--node", badgeId,
  ]);
  primaryChildId = pending.childNodeId ?? pending.child_node_id ?? pending.node_id;
  assert.ok(primaryChildId, `execute must return the pending child id, got ${JSON.stringify(pending)}`);
  createdNodeIds.push(primaryChildId);

  // Wait for the agent to complete + ProjectRoom to land the first
  // asset on the primary + spawn 3 siblings.
  const completed = await waitForCompletion(primaryChildId, 45_000);
  assert.equal(completed.data.status, "completed", `primary child must be completed, got status=${completed.data.status} error=${completed.data.error}`);
  assert.ok(completed.data.assetId, "primary child must have an assetId after completion");

  // Find sibling nodes — they share the action-badge as their source.
  const allImages = clash(["canvas", "list", "--project", PROJECT_ID, "--type", "image"]);
  const siblings = (allImages ?? []).filter((n) => {
    if (n.id === primaryChildId) return false;
    const refs = n?.data?.referenceImageOrder;
    // siblings get an `Output N` style label from the SDK; AND each
    // shares the action-badge as a source via the edges we replicated.
    // We can also identify them via the `tile X/4` label or by their
    // sibling asset id `${taskId}-N`.
    return typeof n?.data?.label === "string" && /tile\s+\d+\/4/i.test(n.data.label);
  });

  for (const s of siblings) createdNodeIds.push(s.id);

  assert.equal(siblings.length, 3, `expected 3 sibling tiles, found ${siblings.length}: ${siblings.map((s) => s.data.label).join(", ")}`);
  for (const sib of siblings) {
    assert.equal(sib.data.status, "completed", `sibling ${sib.id} must be completed`);
    assert.ok(sib.data.assetId, `sibling ${sib.id} must have an assetId`);
    assert.notEqual(sib.data.assetId, completed.data.assetId, "siblings must have distinct assetIds");
  }

  // Sanity: total grid output = 4 unique assets.
  const allAssetIds = new Set([completed.data.assetId, ...siblings.map((s) => s.data.assetId)]);
  assert.equal(allAssetIds.size, 4, "expected 4 distinct assetIds across primary + siblings");
});
