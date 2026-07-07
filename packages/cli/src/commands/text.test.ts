import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertTextCas,
  assertTextNotReferenced,
  createTextLock,
  parseTextLock,
  resolveTextFilePath,
  resolveTextLockPath,
  textCommand,
  textContentFromNode,
} from "./text";

const srcDir = fileURLToPath(new URL("../", import.meta.url));

test("registers a top-level text command for agent-editable text files", () => {
  const indexSource = readFileSync(join(srcDir, "index.ts"), "utf8");
  const daemonSource = readFileSync(join(srcDir, "lib", "daemon.ts"), "utf8");
  const textSource = readFileSync(new URL("./text.ts", import.meta.url), "utf8");

  assert.match(indexSource, /import \{ textCommand \} from "\.\/commands\/text"/);
  assert.match(indexSource, /program\.addCommand\(textCommand\)/);
  assert.equal(textCommand.name(), "text");
  assert.deepEqual(textCommand.commands.map((command) => command.name()), ["pull", "apply", "replace"]);
  assert.match(daemonSource, /case "text_cas_update"/);
  assert.match(daemonSource, /text_cas_update requires string content/);
  assert.match(daemonSource, /case "text_cow_replace"/);
  assert.match(daemonSource, /text_cow_replace requires string content/);
  assert.match(daemonSource, /assertTextNotReferenced/);
  assert.match(textSource, /\.command\("replace"\)/);
  assert.match(textSource, /action: "text_cow_replace"/);
  assert.match(textSource, /import \{[^}]*resolveCanvasPresenceOptions[^}]*\} from "\.\/canvas"/s);
  assert.match(textSource, /\.\.\.resolveCanvasPresenceOptions\(\)/);
  assert.match(textSource, /actorClientType: resolveCanvasPresenceOptions\(\)\.clientType/);
  assert.match(textSource, /readToken: node\.readToken/);
  assert.match(textSource, /readToken: result\.readToken/);
  assert.match(textSource, /assertAgentHostWritePath/);
});

test("rejects text apply when the text node has downstream references", () => {
  const result = assertTextNotReferenced({
    nodeId: "script",
    edges: [
      { source: "script", target: "image_prompt" },
      { source: "other", target: "script" },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Referenced text apply rejected/);
    assert.match(result.error, /image_prompt/);
  }

  assert.deepEqual(
    assertTextNotReferenced({
      nodeId: "script",
      edges: [{ source: "other", target: "script" }],
    }),
    { ok: true },
  );
});

test("allows text apply through unmaterialized action draft references", () => {
  assert.deepEqual(
    assertTextNotReferenced({
      nodeId: "script",
      nodes: [
        { id: "script", type: "text", data: { content: "draft" } },
        { id: "action", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "draft-output", type: "image", data: { status: "draft" } },
      ],
      edges: [
        { source: "script", target: "action" },
        { source: "action", target: "draft-output" },
      ],
    }),
    { ok: true },
  );
});

test("rejects text apply through materialized action checkpoint references", () => {
  const result = assertTextNotReferenced({
    nodeId: "script",
    nodes: [
      { id: "script", type: "text", data: { content: "draft" } },
      { id: "action", type: "action-badge", data: { actionType: "image-gen" } },
      { id: "output", type: "image", data: { status: "completed", assetId: "asset-output" } },
    ],
    edges: [
      { source: "script", target: "action" },
      { source: "action", target: "output" },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Referenced text apply rejected/);
    assert.match(result.error, /action/);
  }
});

test("allows explicit force when text apply rewrites a materialized checkpoint reference", () => {
  assert.deepEqual(
    assertTextNotReferenced({
      nodeId: "script",
      nodes: [
        { id: "script", type: "text", data: { content: "draft" } },
        { id: "action", type: "action-badge", data: { actionType: "image-gen" } },
        { id: "output", type: "image", data: { status: "completed", assetId: "asset-output" } },
      ],
      edges: [
        { source: "script", target: "action" },
        { source: "action", target: "output" },
      ],
      force: true,
    }),
    { ok: true },
  );
});

test("resolves the default agent-editable text file path under the cwd", () => {
  assert.equal(
    resolveTextFilePath({ cwd: "/tmp/project", nodeId: "Node 1/Script" }),
    "/tmp/project/projections/text/node-1-script.md",
  );
  assert.equal(
    resolveTextLockPath({ cwd: "/tmp/project", nodeId: "Node 1/Script" }),
    "/tmp/project/projections/text/node-1-script.lock.json",
  );
});

test("extracts text content from a canvas node", () => {
  assert.equal(
    textContentFromNode({ type: "text", data: { content: "hello" } }),
    "hello",
  );
  assert.equal(
    textContentFromNode({ type: "text", data: { content: 123 } }),
    "",
  );
});

test("creates and parses a text CAS lock", () => {
  const lock = createTextLock({
    projectId: "project_text",
    nodeId: "text_node",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "first draft",
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.kind, "clash.text.lock");
  assert.equal(lock.hashAlgorithm, "sha256-64");
  assert.equal(lock.contentHash.length, 16);
  assert.match(lock.readToken ?? "", /^text-v1:[a-f0-9]{16}$/);
  assert.deepEqual(parseTextLock(JSON.stringify(lock)), lock);
});

test("text CAS lock preserves a host-issued read receipt when pull came through the daemon", () => {
  const readToken = "text-v1:1234567890abcdef:receipt:host-issued";
  const lock = createTextLock({
    projectId: "project_text",
    nodeId: "text_node",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "first draft",
    readToken,
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  assert.equal(lock.readToken, readToken);
  assert.deepEqual(parseTextLock(JSON.stringify(lock)), lock);
});

test("text apply refreshes the lock sidecar after a successful apply", () => {
  const source = readFileSync(new URL("./text.ts", import.meta.url), "utf8");

  assert.match(source, /createTextLock/);
  assert.match(source, /writeFileSync\(lockPath, JSON\.stringify\(refreshedLock/);
  assert.match(source, /contentHash: refreshedLock\.contentHash/);
});

test("rejects text apply when the canvas content changed after pull", () => {
  const lock = createTextLock({
    projectId: "project_text",
    nodeId: "text_node",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "first draft",
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  const stale = assertTextCas({
    projectId: "project_text",
    nodeId: "text_node",
    lock,
    currentContent: "changed elsewhere",
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.error, /Stale text apply rejected/);

  assert.deepEqual(
    assertTextCas({
      projectId: "project_text",
      nodeId: "text_node",
      lock,
      currentContent: "first draft",
    }),
    { ok: true },
  );
  assert.deepEqual(
    assertTextCas({
      projectId: "project_text",
      nodeId: "text_node",
      lock,
      currentContent: "changed elsewhere",
      force: true,
    }),
    { ok: true },
  );
});

test("rejects text apply when the Markdown file does not match the lock", () => {
  const lock = createTextLock({
    projectId: "project_text",
    nodeId: "text_node",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "first draft",
    pulledAt: "2026-07-05T00:00:00.000Z",
  });

  const result = assertTextCas({
    projectId: "project_text",
    nodeId: "text_node",
    lock,
    currentContent: "first draft",
    filePath: "/tmp/project/projections/text/other-node.md",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Projection file path does not match text CAS lock/);
});
