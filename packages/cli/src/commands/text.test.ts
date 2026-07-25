import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertTextNotReferenced,
  createTextAppliedRevision,
  fetchTextRevisionHistory,
  registerTextRevisionIndex,
  resolveTextFilePath,
  restoreTextRevisionContent,
  textHash,
  textReadToken,
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
  assert.deepEqual(textCommand.commands.map((command) => command.name()), ["pull", "apply", "replace", "history", "content", "restore"]);
  assert.match(daemonSource, /case "text_cas_update"/);
  assert.match(daemonSource, /text_cas_update requires string content/);
  assert.match(daemonSource, /case "text_cow_replace"/);
  assert.match(daemonSource, /text_cow_replace requires string content/);
  assert.match(daemonSource, /isCanvasNodeImmutable/);
  assert.match(textSource, /\.command\("replace"\)/);
  assert.match(textSource, /action: "text_cow_replace"/);
  assert.match(textSource, /import \{[^}]*resolveCanvasPresenceOptions[^}]*\} from "\.\/canvas"/s);
  assert.match(textSource, /\.\.\.resolveCanvasPresenceOptions\(\)/);
  assert.match(textSource, /actorClientType: resolveCanvasPresenceOptions\(\)\.clientType/);
  assert.match(textSource, /recordWorktreeObservation/);
  assert.match(textSource, /requireWorktreeObservation/);
  assert.match(textSource, /observedVersion/);
  assert.match(textSource, /assertAgentHostWritePath/);
  assert.doesNotMatch(textSource, /TextLock|createTextLock|parseTextLock|resolveTextLockPath|assertTextCas|expectedContentHash|expectedTextFilePath|expectedReadToken/);
  assert.doesNotMatch(daemonSource, /TextLock|createTextLockFromHash|expectedContentHash|expectedTextFilePath/);
  for (const commandName of ["apply", "replace", "restore"]) {
    const command = textCommand.commands.find((candidate) => candidate.name() === commandName);
    assert.ok(command);
    assert.equal(command.options.some((option) => option.long === "--lock"), false);
  }
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

test("resolves the default agent-editable text file path under the cwd", () => {
  assert.equal(
    resolveTextFilePath({ cwd: "/tmp/project", nodeId: "Node 1/Script" }),
    "/tmp/project/projections/text/node-1-script.md",
  );
  assert.throws(
    () => resolveTextFilePath({ cwd: "/tmp/project", file: "../outside.md", nodeId: "text_node" }),
    /Projection file path must stay inside the current project cwd/,
  );
  assert.throws(
    () => resolveTextFilePath({ cwd: "/tmp/project", file: "/tmp/other-project/script.md", nodeId: "text_node" }),
    /Projection file path must stay inside the current project cwd/,
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

test("creates text applied revision milestones for file-backed text edits", () => {
  const revision = createTextAppliedRevision({
    projectId: "project_text",
    nodeId: "text_node",
    cwd: "/tmp/project",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "versioned copy",
    parentRevisionId: "txrev-parent",
    createdAt: "2026-07-07T00:00:00.000Z",
    actor: { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" },
  });

  assert.equal(revision.schemaVersion, 1);
  assert.equal(revision.kind, "clash.text.revision");
  assert.equal(revision.textId, "text:project_text:text_node");
  assert.match(revision.revisionId, /^txrev-[a-f0-9]{16}-[a-f0-9]{12}$/);
  assert.equal(revision.parentRevisionId, "txrev-parent");
  assert.equal(revision.projectId, "project_text");
  assert.equal(revision.nodeId, "text_node");
  assert.equal(revision.contentHash, textHash("versioned copy"));
  assert.equal(revision.sourceFilePath, "projections/text/text-node.md");
  assert.equal(revision.sourceFileHash, textHash("versioned copy"));
  assert.deepEqual(revision.actor, { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" });

});

test("registers text revisions through the host index API when available", async () => {
  const revision = createTextAppliedRevision({
    projectId: "project_text",
    nodeId: "text_node",
    cwd: "/tmp/project",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "indexed copy",
    createdAt: "2026-07-07T00:00:00.000Z",
  });
  const calls: Array<{ path: string; contentType: string | null; body: unknown }> = [];

  const result = await registerTextRevisionIndex(revision, "indexed copy", async (path, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      contentType: headers.get("content-type"),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ revision }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(result, { indexed: true });
  assert.deepEqual(calls, [{
    path: "/api/v1/text-revisions",
    contentType: "application/json",
    body: { revision, content: "indexed copy" },
  }]);
});

test("keeps text apply compatible when the host text revision index is unavailable", async () => {
  const revision = createTextAppliedRevision({
    projectId: "project_text",
    nodeId: "text_node",
    cwd: "/tmp/project",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "remote copy",
    createdAt: "2026-07-07T00:00:00.000Z",
  });

  const result = await registerTextRevisionIndex(revision, "remote copy", async () =>
    new Response("missing", { status: 404 }),
  );

  assert.deepEqual(result, {
    indexed: false,
    status: 404,
    error: "text revision index API unavailable",
  });
});

test("fetches text revision history through the host API", async () => {
  const revision = createTextAppliedRevision({
    projectId: "project_text",
    nodeId: "text_node",
    cwd: "/tmp/project",
    filePath: "/tmp/project/projections/text/text-node.md",
    content: "indexed copy",
    createdAt: "2026-07-07T00:00:00.000Z",
  });
  const revisionWithContent = {
    ...revision,
    content: {
      kind: "text-revision-content",
      contentHash: revision.contentHash,
      mediaType: "text/markdown",
      url: `/api/v1/projects/project_text/text-revisions/${revision.revisionId}/content`,
      immutable: true,
      storage: {
        kind: "content-addressed-revision-blob",
        registry: "text_revisions",
        mediaAsset: false,
        agentWritable: false,
      },
    },
  };
  const calls: Array<{ path: string; method: string | undefined }> = [];

  const result = await fetchTextRevisionHistory("project_text", { nodeId: "text_node", limit: 2 }, async (path, init) => {
    calls.push({ path, method: init?.method });
    return new Response(JSON.stringify({ revisions: [revisionWithContent] }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(result, { revisions: [revisionWithContent] });
  assert.deepEqual(calls, [{
    path: "/api/v1/projects/project_text/text-revisions?nodeId=text_node&limit=2",
    method: "GET",
  }]);
});

test("fetches text revision content through the host API", async () => {
  const module = await import("./text");
  assert.equal(typeof module.fetchTextRevisionContent, "function");
  const calls: Array<{ path: string; method: string | undefined }> = [];

  const result = await module.fetchTextRevisionContent("project_text", "txrev-1", async (path, init) => {
    calls.push({ path, method: init?.method });
    return new Response("versioned markdown\n", { status: 200, headers: { "content-type": "text/markdown" } });
  });

  assert.equal(result, "versioned markdown\n");
  assert.deepEqual(calls, [{
    path: "/api/v1/projects/project_text/text-revisions/txrev-1/content",
    method: "GET",
  }]);
});

test("restores text revision content through a read-before-write copy-on-write replace by default", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "clash-text-restore-"));
  const revisionId = "txrev-source";
  const replaceCalls: Array<{
    projectId: string;
    nodeId: string;
    content: string;
    cas: any;
  }> = [];

  const result = await restoreTextRevisionContent({
    projectId: "project_text",
    nodeId: "text_node",
    revisionId,
    cwd,
  }, {
    fetchContent: async () => "restored body\n",
    readNode: async () => ({
      type: "text",
      data: { content: "current body\n" },
    }),
    replace: async (projectId, nodeId, content, cas) => {
      replaceCalls.push({ projectId, nodeId, content, cas });
      const textRevision = createTextAppliedRevision({
        projectId,
        nodeId: "text_node_copy",
        cwd,
        filePath: cas.filePath,
        content,
        parentRevisionId: cas.parentRevisionId,
        createdAt: "2026-07-09T00:00:00.000Z",
      });
      return {
        replaced: true,
        copyOnWrite: true,
        sourceNodeId: nodeId,
        newNodeId: "text_node_copy",
        contentHash: textHash(content),
        textRevision,
        version: textReadToken({ projectId, nodeId: "text_node_copy", content }),
      };
    },
    register: async () => ({ indexed: true }),
  });

  assert.equal(result.mode, "replace");
  assert.equal(result.revisionId, revisionId);
  assert.equal(result.copyOnWrite, true);
  assert.equal(result.newNodeId, "text_node_copy");
  assert.equal(readFileSync(join(cwd, "revisions", "txrev-source.md"), "utf8"), "restored body\n");
  const replaceCall = replaceCalls[0];
  assert.ok(replaceCall);
  assert.equal(replaceCall.projectId, "project_text");
  assert.equal(replaceCall.nodeId, "text_node");
  assert.equal(replaceCall.content, "restored body\n");
  assert.equal("lock" in replaceCall.cas, false);
  assert.equal(
    replaceCall.cas.observedVersion,
    textReadToken({ projectId: "project_text", nodeId: "text_node", content: "current body\n" }),
  );
  assert.equal(replaceCall.cas.parentRevisionId, revisionId);
  assert.equal("lockPath" in result, false);
  assert.equal(result.contentHash, textHash("restored body\n"));
});

test("text apply refreshes the cwd observation after a successful apply", () => {
  const source = readFileSync(new URL("./text.ts", import.meta.url), "utf8");

  assert.match(source, /await recordTextObservation\(/);
  assert.match(source, /result\.version \?\? textReadToken/);
  assert.match(source, /contentHash: textHash\(content\)/);
});
