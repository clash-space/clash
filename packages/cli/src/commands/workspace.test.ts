import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  projectWorkspaceId,
  writeWorkspaceBundleManifest,
} from "@clash/shared-runtime";

import { createCliProgram } from "../program";
import { readProjectMarker, writeProjectMarker } from "../lib/project-context";
import * as workspaceModule from "./workspace";

test("workspace command registers export, inspect, and import without overwrite switches", () => {
  const command = createCliProgram().commands.find(
    (candidate) => candidate.name() === "workspace",
  );
  assert.ok(command);
  assert.deepEqual(
    command.commands.map((candidate) => candidate.name()),
    ["export", "inspect", "import"],
  );

  const exportCommand = command.commands[0]!;
  const inspectCommand = command.commands[1]!;
  const importCommand = command.commands[2]!;
  assert.ok(exportCommand.options.some((option) => option.long === "--out"));
  assert.ok(inspectCommand.options.some((option) => option.long === "--json"));
  assert.ok(importCommand.options.some((option) => option.long === "--into"));
  for (const subcommand of command.commands) {
    assert.ok(!subcommand.options.some((option) => option.long === "--force"));
    assert.ok(
      !subcommand.options.some((option) => option.long === "--overwrite"),
    );
    assert.ok(!subcommand.options.some((option) => option.long === "--merge"));
    assert.ok(!subcommand.options.some((option) => option.long === "--fork"));
  }
});

test("workspace directory publication cannot overwrite an empty target race", async (context) => {
  const publishWorkspaceDirectory = (
    workspaceModule as unknown as {
      publishWorkspaceDirectory?: (input: {
        stagingRoot: string;
        target: string;
        completionPath: string;
      }) => Promise<void>;
    }
  ).publishWorkspaceDirectory;
  assert.equal(typeof publishWorkspaceDirectory, "function");
  if (!publishWorkspaceDirectory) return;

  const root = await mkdtemp(join(tmpdir(), "clash-cli-workspace-publish-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const stagingRoot = join(root, "staging");
  const target = join(root, "target");
  await mkdir(stagingRoot);
  await writeFile(join(stagingRoot, "payload.txt"), "complete payload\n");
  await writeFile(join(stagingRoot, "workspace.json"), "{}\n");

  const [publication, competitor] = await Promise.allSettled([
    publishWorkspaceDirectory({
      stagingRoot,
      target,
      completionPath: "workspace.json",
    }),
    mkdir(target),
  ]);
  assert.equal(
    [publication, competitor].filter((result) => result.status === "fulfilled")
      .length,
    1,
  );

  if (publication.status === "fulfilled") {
    assert.equal(competitor.status, "rejected");
    assert.equal(
      await readFile(join(target, "payload.txt"), "utf8"),
      "complete payload\n",
    );
    assert.equal(
      await readFile(join(target, "workspace.json"), "utf8"),
      "{}\n",
    );
  } else {
    assert.equal(competitor.status, "fulfilled");
    assert.deepEqual(await readdir(target), []);
    assert.equal(
      await readFile(join(stagingRoot, "payload.txt"), "utf8"),
      "complete payload\n",
    );
  }
});

test("workspace publication syncs payload directories before its completion marker", async (context) => {
  const publishWorkspaceDirectory = (
    workspaceModule as unknown as {
      publishWorkspaceDirectory?: (input: {
        stagingRoot: string;
        target: string;
        completionPath: string;
        syncDirectory?: (path: string) => Promise<void>;
      }) => Promise<void>;
    }
  ).publishWorkspaceDirectory;
  assert.equal(typeof publishWorkspaceDirectory, "function");
  if (!publishWorkspaceDirectory) return;

  const root = await mkdtemp(join(tmpdir(), "clash-cli-workspace-sync-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const stagingRoot = join(root, "staging");
  const target = join(root, "target");
  await mkdir(join(stagingRoot, "payload"), { recursive: true });
  await writeFile(join(stagingRoot, "payload", "asset.bin"), "asset\n");
  await writeFile(join(stagingRoot, "workspace.json"), "{}\n");

  const syncs: Array<{ path: string; completionVisible: boolean }> = [];
  await publishWorkspaceDirectory({
    stagingRoot,
    target,
    completionPath: "workspace.json",
    async syncDirectory(path) {
      const completionVisible = await lstat(join(target, "workspace.json"))
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
      syncs.push({ path, completionVisible });
    },
  });

  assert.deepEqual(syncs, [
    { path: join(target, "payload"), completionVisible: false },
    { path: target, completionVisible: false },
    { path: target, completionVisible: true },
    { path: root, completionVisible: true },
  ]);
});

test("workspace export publishes one verified bundle from Host authority and the planned worktree", async (context) => {
  const exportWorkspace = (
    workspaceModule as unknown as {
      exportWorkspace?: (input: Record<string, unknown>) => Promise<{
        bundlePath: string;
        bundleDigest: string;
        projectId: string;
        files: number;
      }>;
    }
  ).exportWorkspace;
  assert.equal(typeof exportWorkspace, "function");
  if (!exportWorkspace) return;

  const root = await mkdtemp(join(tmpdir(), "clash-cli-workspace-export-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const out = join(root, "portable-workspace");
  await mkdir(source);
  await writeFile(join(source, "story.md"), "portable story\n");
  await writeFile(join(source, "render.sh"), "#!/bin/sh\nexit 0\n");
  await chmod(join(source, "render.sh"), 0o755);
  await writeProjectMarker(source, {
    schemaVersion: 1,
    projectId: "project-export",
    workspaceId: "external:workspace-source",
    store: "external",
  });
  await writeFile(join(source, ".clash", "observed.json"), "{}\n");

  const projectBytes = new Uint8Array([1, 2, 3, 4]);
  const projectSha256 = createHash("sha256").update(projectBytes).digest("hex");
  let checkpointCalls = 0;
  const result = await exportWorkspace({
    cwd: source,
    out,
    client: {
      async createExport(input: unknown) {
        checkpointCalls += 1;
        await assert.rejects(lstat(out), { code: "ENOENT" });
        assert.deepEqual(input, {
          projectId: "project-export",
          sourceWorkspaceId: "external:workspace-source",
        });
        return {
          schemaVersion: 1,
          kind: "clash.workspace.export-plan",
          exportId: "export_capability_1234",
          expiresAt: "2026-08-15T00:00:00.000Z",
          source: {
            projectId: "project-export",
            sourceWorkspaceId: "external:workspace-source",
            display: { name: "Portable Project" },
          },
          content: {
            workspaceRoot: "workspace",
            project: {
              path: "project.bin",
              codec: "loro-shallow-snapshot",
              codecVersion: 1,
            },
            resources: [],
            documentBodies: [],
            textRevisions: [],
          },
          semanticRequirements: {
            generatorDefinitions: [],
            modelReferences: [],
          },
          files: [
            {
              fileId: "project_file_cap_1234",
              path: "project.bin",
              role: "project",
              bytes: projectBytes.byteLength,
              sha256: projectSha256,
              mode: "0644",
            },
          ],
        };
      },
      async downloadExportFile() {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(projectBytes.subarray(0, 2));
              controller.enqueue(projectBytes.subarray(2));
              controller.close();
            },
          }),
          { status: 200 },
        );
      },
    },
  });

  assert.equal(checkpointCalls, 1);
  assert.equal(result.bundlePath, out);
  assert.equal(result.projectId, "project-export");
  assert.equal(result.files, 3);
  assert.match(result.bundleDigest, /^[a-f0-9]{64}$/u);
  assert.equal(
    await readFile(join(out, "story.md"), "utf8").catch(() => null),
    null,
  );
  assert.equal(
    await readFile(join(out, "workspace", "story.md"), "utf8"),
    "portable story\n",
  );
  assert.equal(
    (await readFile(join(out, "project.bin"))).compare(projectBytes),
    0,
  );
  await assert.rejects(
    readFile(join(out, "workspace", ".clash", "project.toml")),
    {
      code: "ENOENT",
    },
  );
  await assert.rejects(
    readFile(join(out, "workspace", ".clash", "observed.json")),
    {
      code: "ENOENT",
    },
  );
  const manifest = JSON.parse(
    await readFile(join(out, "workspace.json"), "utf8"),
  ) as {
    integrity: { bundleDigest: string };
    excluded: Array<{ path: string }>;
  };
  assert.equal(manifest.integrity.bundleDigest, result.bundleDigest);
  assert.deepEqual(
    manifest.excluded.map((entry) => entry.path),
    [".clash/observed.json", ".clash/project.toml"],
  );
});

test("workspace inspect verifies a bundle offline and reports stable content facts", async (context) => {
  const inspectWorkspace = (
    workspaceModule as unknown as {
      inspectWorkspace?: (input: { bundle: string }) => Promise<unknown>;
    }
  ).inspectWorkspace;
  assert.equal(typeof inspectWorkspace, "function");
  if (!inspectWorkspace) return;

  const bundle = await mkdtemp(join(tmpdir(), "clash-cli-workspace-inspect-"));
  context.after(() => rm(bundle, { recursive: true, force: true }));
  const projectBytes = new Uint8Array([8, 6, 7, 5]);
  const story = "inspect me\n";
  await mkdir(join(bundle, "workspace"));
  await writeFile(join(bundle, "project.bin"), projectBytes);
  await writeFile(join(bundle, "workspace", "story.md"), story);
  const manifest = await writeWorkspaceBundleManifest(bundle, {
    schemaVersion: 1,
    kind: "clash.workspace.bundle",
    source: {
      projectId: "project-inspect",
      display: { name: "Inspect Project" },
    },
    content: {
      workspaceRoot: "workspace",
      project: {
        path: "project.bin",
        codec: "loro-shallow-snapshot",
        codecVersion: 1,
      },
      resources: [],
      documentBodies: [],
      textRevisions: [],
    },
    semanticRequirements: { generatorDefinitions: [], modelReferences: [] },
    files: [
      {
        path: "project.bin",
        role: "project",
        bytes: projectBytes.byteLength,
        sha256: createHash("sha256").update(projectBytes).digest("hex"),
        mode: "0644",
      },
      {
        path: "workspace/story.md",
        role: "workspace",
        bytes: Buffer.byteLength(story),
        sha256: createHash("sha256").update(story).digest("hex"),
        mode: "0644",
      },
    ],
    excluded: [],
  });

  assert.deepEqual(await inspectWorkspace({ bundle }), {
    valid: true,
    bundlePath: bundle,
    bundleDigest: manifest.integrity.bundleDigest,
    projectId: "project-inspect",
    filesVerified: 2,
    workspaceFiles: 1,
    objectFiles: 0,
    payloadBytes: projectBytes.byteLength + Buffer.byteLength(story),
    excluded: [],
  });
});

test("workspace import rejects an invalid bundle before transport or target staging", async (context) => {
  const importWorkspace = (
    workspaceModule as unknown as {
      importWorkspace?: (input: Record<string, unknown>) => Promise<unknown>;
    }
  ).importWorkspace;
  assert.equal(typeof importWorkspace, "function");
  if (!importWorkspace) return;

  const root = await mkdtemp(
    join(tmpdir(), "clash-cli-workspace-import-invalid-"),
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  const target = join(root, "new-worktree");
  await mkdir(bundle);
  await writeFile(join(bundle, "workspace.json"), "{}\n");
  let transportCalls = 0;
  await assert.rejects(
    importWorkspace({
      bundle,
      into: target,
      client: {
        async startImport() {
          transportCalls += 1;
          throw new Error("must not be called");
        },
      },
    }),
    /manifest|bundle/iu,
  );
  assert.equal(transportCalls, 0);
  await assert.rejects(lstat(target), { code: "ENOENT" });
});

test("workspace import stages the worktree, uploads only missing Host slots, then publishes a fresh marker", async (context) => {
  const importWorkspace = (
    workspaceModule as unknown as {
      importWorkspace?: (input: Record<string, unknown>) => Promise<{
        targetPath: string;
        projectId: string;
        workspaceId: string;
        markerPath: string;
        bundleDigest: string;
        status: string;
      }>;
    }
  ).importWorkspace;
  assert.equal(typeof importWorkspace, "function");
  if (!importWorkspace) return;

  const root = await mkdtemp(join(tmpdir(), "clash-cli-workspace-import-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  const target = join(root, "new-worktree");
  const projectBytes = new Uint8Array([11, 22, 33, 44, 55]);
  const projectSha256 = createHash("sha256").update(projectBytes).digest("hex");
  const story = "restored story\n";
  await mkdir(join(bundle, "workspace"), { recursive: true });
  await writeFile(join(bundle, "project.bin"), projectBytes);
  await writeFile(join(bundle, "workspace", "story.md"), story);
  const manifest = await writeWorkspaceBundleManifest(bundle, {
    schemaVersion: 1,
    kind: "clash.workspace.bundle",
    source: {
      projectId: "project-import",
      display: { name: "Import Project" },
    },
    content: {
      workspaceRoot: "workspace",
      project: {
        path: "project.bin",
        codec: "loro-shallow-snapshot",
        codecVersion: 1,
      },
      resources: [],
      documentBodies: [],
      textRevisions: [],
    },
    semanticRequirements: { generatorDefinitions: [], modelReferences: [] },
    files: [
      {
        path: "project.bin",
        role: "project",
        bytes: projectBytes.byteLength,
        sha256: projectSha256,
        mode: "0644",
      },
      {
        path: "workspace/story.md",
        role: "workspace",
        bytes: Buffer.byteLength(story),
        sha256: createHash("sha256").update(story).digest("hex"),
        mode: "0644",
      },
    ],
    excluded: [
      { path: ".clash/project.toml", reason: "target-marker-regenerated" },
    ],
  });
  const idempotencyKey = `workspace-import:${manifest.integrity.bundleDigest}`;
  const source = manifest.source;
  const projectSlot = {
    fileId: "import_project_slot_1234",
    path: "project.bin",
    role: "project" as const,
    bytes: projectBytes.byteLength,
    sha256: projectSha256,
    mode: "0644" as const,
  };
  const calls: string[] = [];
  let uploaded = false;

  const result = await importWorkspace({
    bundle,
    into: target,
    client: {
      async startImport(input: unknown) {
        calls.push("start");
        await assert.rejects(lstat(target), { code: "ENOENT" });
        const stagingName = (await readdir(root)).find((name) =>
          name.endsWith(".workspace-import"),
        );
        assert.ok(stagingName);
        assert.equal(
          await readFile(
            join(root, stagingName, "workspace", "story.md"),
            "utf8",
          ),
          story,
        );
        assert.deepEqual(input, {
          schemaVersion: 1,
          kind: "clash.workspace.import-start",
          idempotencyKey,
          bundleDigest: manifest.integrity.bundleDigest,
          manifest,
        });
        return {
          schemaVersion: 1,
          kind: "clash.workspace.import-session",
          importId: "import_session_cap_1234",
          idempotencyKey,
          bundleDigest: manifest.integrity.bundleDigest,
          source,
          target: { projectId: "project-import" },
          expiresAt: "2026-08-15T00:00:00.000Z",
          status: "staging",
          files: [{ ...projectSlot, state: "missing" }],
        };
      },
      async uploadImportFile(input: {
        importId: string;
        fileId: string;
        body: ReadableStream<Uint8Array>;
        bytes: number;
        sha256: string;
      }) {
        calls.push("upload");
        assert.equal(input.importId, "import_session_cap_1234");
        assert.equal(input.fileId, projectSlot.fileId);
        assert.equal(input.bytes, projectBytes.byteLength);
        assert.equal(input.sha256, projectSha256);
        assert.ok(input.body instanceof ReadableStream);
        const chunks: Uint8Array[] = [];
        const reader = input.body.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          chunks.push(next.value);
        }
        assert.equal(Buffer.concat(chunks).compare(projectBytes), 0);
        uploaded = true;
        return {
          schemaVersion: 1,
          kind: "clash.workspace.import-file-upload-receipt",
          importId: "import_session_cap_1234",
          fileId: projectSlot.fileId,
          state: "present",
          bytes: projectBytes.byteLength,
          sha256: projectSha256,
        };
      },
      async getImport(input: unknown) {
        calls.push("get");
        assert.deepEqual(input, { importId: "import_session_cap_1234" });
        assert.equal(uploaded, true);
        return {
          schemaVersion: 1,
          kind: "clash.workspace.import-session",
          importId: "import_session_cap_1234",
          idempotencyKey,
          bundleDigest: manifest.integrity.bundleDigest,
          source,
          target: { projectId: "project-import" },
          expiresAt: "2026-08-15T00:00:00.000Z",
          status: "staging",
          files: [{ ...projectSlot, state: "present" }],
        };
      },
      async commitImport(input: unknown) {
        calls.push("commit");
        await assert.rejects(lstat(target), { code: "ENOENT" });
        assert.deepEqual(input, {
          importId: "import_session_cap_1234",
          schemaVersion: 1,
          kind: "clash.workspace.import-commit",
          idempotencyKey,
          bundleDigest: manifest.integrity.bundleDigest,
        });
        return {
          schemaVersion: 1,
          kind: "clash.workspace.import-commit-response",
          status: "committed",
          importId: "import_session_cap_1234",
          idempotencyKey,
          bundleDigest: manifest.integrity.bundleDigest,
          source,
          target: { projectId: "project-import" },
          committedAt: "2026-08-14T01:00:00.000Z",
        };
      },
    },
  });

  const expectedWorkspaceId = projectWorkspaceId(
    "external",
    "project-import",
    target,
  );
  assert.deepEqual(calls, ["start", "upload", "get", "commit"]);
  assert.deepEqual(result, {
    targetPath: target,
    projectId: "project-import",
    workspaceId: expectedWorkspaceId,
    markerPath: join(target, ".clash", "project.toml"),
    bundleDigest: manifest.integrity.bundleDigest,
    status: "committed",
  });
  assert.equal(await readFile(join(target, "story.md"), "utf8"), story);
  const marker = await readProjectMarker(result.markerPath);
  assert.deepEqual(marker, {
    schemaVersion: 1,
    projectId: "project-import",
    workspaceId: expectedWorkspaceId,
    store: "external",
  });
  await assert.rejects(readFile(join(target, ".clash", "observed.json")), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(join(target, "project.bin")), {
    code: "ENOENT",
  });
});

test("workspace transport uses opaque capability routes and a streaming raw PUT", async () => {
  const createClient = (
    workspaceModule as unknown as {
      createWorkspaceTransferClient?: (input: Record<string, unknown>) => {
        createExport(input: unknown): Promise<unknown>;
        downloadExportFile(input: unknown): Promise<Response>;
        startImport(input: unknown): Promise<unknown>;
        getImport(input: unknown): Promise<unknown>;
        uploadImportFile(input: Record<string, unknown>): Promise<unknown>;
        commitImport(input: unknown): Promise<unknown>;
      };
    }
  ).createWorkspaceTransferClient;
  assert.equal(typeof createClient, "function");
  if (!createClient) return;

  const digest = createHash("sha256").update("bin").digest("hex");
  const bundleDigest = "a".repeat(64);
  const source = {
    projectId: "project-transport",
    sourceWorkspaceId: "external:transport-source",
    display: { name: "Transport Project" },
  };
  const { sourceWorkspaceId: _sourceWorkspaceId, ...portableSource } = source;
  const content = {
    workspaceRoot: "workspace" as const,
    project: {
      path: "project.bin" as const,
      codec: "loro-shallow-snapshot" as const,
      codecVersion: 1 as const,
    },
    resources: [],
    documentBodies: [],
    textRevisions: [],
  };
  const semanticRequirements = {
    generatorDefinitions: [],
    modelReferences: [],
  };
  const file = {
    fileId: "transport_file_cap_1234",
    path: "project.bin",
    role: "project" as const,
    bytes: 3,
    sha256: digest,
    mode: "0644" as const,
  };
  const idempotencyKey = `workspace-import:${bundleDigest}`;
  const manifest = {
    schemaVersion: 1 as const,
    kind: "clash.workspace.bundle" as const,
    source: portableSource,
    content,
    semanticRequirements,
    files: [{ ...file, fileId: undefined }].map(
      ({ fileId: _fileId, ...entry }) => entry,
    ),
    excluded: [],
    integrity: {
      algorithm: "sha256" as const,
      canonicalization: "clash.workspace-manifest-json.v1" as const,
      bundleDigest,
    },
  };
  const session = {
    schemaVersion: 1 as const,
    kind: "clash.workspace.import-session" as const,
    importId: "transport_session_1234",
    idempotencyKey,
    bundleDigest,
    source: portableSource,
    target: { projectId: source.projectId },
    expiresAt: "2026-08-15T00:00:00.000Z",
    status: "staging" as const,
    files: [{ ...file, state: "missing" as const }],
  };
  const requests: Array<{
    method: string;
    path: string;
    authorization: string | null;
  }> = [];
  let uploadedBody = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get("authorization"),
    });
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path.endsWith("/workspace-exports")) {
      return Response.json({
        schemaVersion: 1,
        kind: "clash.workspace.export-plan",
        exportId: "transport_export_1234",
        expiresAt: "2026-08-15T00:00:00.000Z",
        source,
        content,
        semanticRequirements,
        files: [file],
      });
    }
    if (request.method === "GET" && path.includes("/workspace-exports/")) {
      return new Response("bin");
    }
    if (request.method === "POST" && path === "/api/v1/workspace-imports") {
      return Response.json(session);
    }
    if (request.method === "GET" && path.endsWith("/transport_session_1234")) {
      return Response.json({
        ...session,
        files: [{ ...file, state: "present" }],
      });
    }
    if (request.method === "PUT") {
      uploadedBody = await request.text();
      return Response.json({
        schemaVersion: 1,
        kind: "clash.workspace.import-file-upload-receipt",
        importId: session.importId,
        fileId: file.fileId,
        state: "present",
        bytes: 3,
        sha256: digest,
      });
    }
    if (request.method === "POST" && path.endsWith("/commit")) {
      return Response.json({
        schemaVersion: 1,
        kind: "clash.workspace.import-commit-response",
        status: "committed",
        importId: session.importId,
        idempotencyKey,
        bundleDigest,
        source: portableSource,
        target: { projectId: source.projectId },
        committedAt: "2026-08-14T02:00:00.000Z",
      });
    }
    return new Response("unexpected", { status: 500 });
  };
  const client = createClient({
    endpoint: "http://127.0.0.1:8789/",
    token: "local-token",
    fetch: fakeFetch,
  });

  await client.createExport({
    projectId: source.projectId,
    sourceWorkspaceId: source.sourceWorkspaceId,
  });
  await client.downloadExportFile({
    exportId: "transport_export_1234",
    fileId: file.fileId,
  });
  await client.startImport({
    schemaVersion: 1,
    kind: "clash.workspace.import-start",
    idempotencyKey,
    bundleDigest,
    manifest,
  });
  await client.getImport({ importId: session.importId });
  await client.uploadImportFile({
    importId: session.importId,
    fileId: file.fileId,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("bin"));
        controller.close();
      },
    }),
    bytes: 3,
    sha256: digest,
  });
  await client.commitImport({
    importId: session.importId,
    schemaVersion: 1,
    kind: "clash.workspace.import-commit",
    idempotencyKey,
    bundleDigest,
  });

  assert.equal(uploadedBody, "bin");
  assert.deepEqual(
    requests.map(({ method, path }) => [method, path]),
    [
      ["POST", "/api/v1/projects/project-transport/workspace-exports"],
      [
        "GET",
        `/api/v1/workspace-exports/transport_export_1234/files/${file.fileId}`,
      ],
      ["POST", "/api/v1/workspace-imports"],
      ["GET", `/api/v1/workspace-imports/${session.importId}`],
      [
        "PUT",
        `/api/v1/workspace-imports/${session.importId}/files/${file.fileId}`,
      ],
      ["POST", `/api/v1/workspace-imports/${session.importId}/commit`],
    ],
  );
  assert.ok(
    requests.every((request) => request.authorization === "Bearer local-token"),
  );
});

test("workspace inspect command executes offline verification and prints JSON", async (context) => {
  const bundle = await mkdtemp(join(tmpdir(), "clash-cli-workspace-command-"));
  context.after(() => rm(bundle, { recursive: true, force: true }));
  const projectBytes = new Uint8Array([4, 2]);
  await writeFile(join(bundle, "project.bin"), projectBytes);
  const manifest = await writeWorkspaceBundleManifest(bundle, {
    schemaVersion: 1,
    kind: "clash.workspace.bundle",
    source: {
      projectId: "project-command",
      display: { name: "Command Project" },
    },
    content: {
      workspaceRoot: "workspace",
      project: {
        path: "project.bin",
        codec: "loro-shallow-snapshot",
        codecVersion: 1,
      },
      resources: [],
      documentBodies: [],
      textRevisions: [],
    },
    semanticRequirements: { generatorDefinitions: [], modelReferences: [] },
    files: [
      {
        path: "project.bin",
        role: "project",
        bytes: projectBytes.byteLength,
        sha256: createHash("sha256").update(projectBytes).digest("hex"),
        mode: "0644",
      },
    ],
    excluded: [],
  });
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    await workspaceModule.workspaceCommand.parseAsync(
      ["inspect", bundle, "--json"],
      { from: "user" },
    );
  } finally {
    console.log = originalLog;
  }

  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]!) as unknown, {
    valid: true,
    bundlePath: bundle,
    bundleDigest: manifest.integrity.bundleDigest,
    projectId: "project-command",
    filesVerified: 1,
    workspaceFiles: 0,
    objectFiles: 0,
    payloadBytes: 2,
    excluded: [],
  });
});
