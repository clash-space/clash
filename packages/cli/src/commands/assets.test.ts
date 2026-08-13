import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, lstat, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetsCommand,
  fetchProjectAssetRecord,
  fetchProjectAssetReferences,
  importAssetFile,
  linkAssetIntoProject,
  listProjectAssetRecords,
  replaceAssetFile,
  resolveAssetLinkName,
  restoreProjectAsset,
  trashProjectAsset,
} from "./assets";
import type { ProjectAssetHostClient } from "@clash/shared-runtime/project-asset-client";
import { initProject } from "./projects";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-assets-link-"));
}

test("assets command registers link subcommand", () => {
  assert.equal(assetsCommand.name(), "assets");
  assert.deepEqual(
    assetsCommand.commands.map((command) => command.name()),
    [
      "list",
      "get",
      "link",
      "import",
      "replace",
      "refs",
      "delete",
      "restore",
      "metadata",
    ],
  );
  const get = assetsCommand.commands.find(
    (command) => command.name() === "get",
  );
  assert.ok(get);
  assert.ok(get.options.some((option) => option.long === "--asset"));
  assert.ok(get.options.some((option) => option.long === "--project"));
  const replace = assetsCommand.commands.find(
    (command) => command.name() === "replace",
  );
  assert.ok(replace);
  assert.ok(!replace.options.some((option) => option.long === "--if-match"));
  assert.ok(!replace.options.some((option) => option.long === "--force"));
  const refs = assetsCommand.commands.find(
    (command) => command.name() === "refs",
  );
  assert.ok(refs);
  assert.ok(refs.options.some((option) => option.long === "--asset"));
  assert.ok(refs.options.some((option) => option.long === "--project"));
  assert.ok(!refs.options.some((option) => option.long === "--refresh"));
  const remove = assetsCommand.commands.find(
    (command) => command.name() === "delete",
  );
  assert.ok(remove);
  assert.ok(remove.options.some((option) => option.long === "--yes"));
  assert.ok(!remove.options.some((option) => option.long === "--force"));
  assert.ok(!remove.options.some((option) => option.long === "--if-match"));
  assert.ok(!remove.options.some((option) => option.long === "--read-token"));
  const restore = assetsCommand.commands.find(
    (command) => command.name() === "restore",
  );
  assert.ok(restore);
  assert.ok(!restore.options.some((option) => option.long === "--force"));
  assert.ok(!restore.options.some((option) => option.long === "--if-match"));
  assert.ok(!restore.options.some((option) => option.long === "--read-token"));
});

test("asset link names must stay inside the project asset links directory", () => {
  assert.equal(
    resolveAssetLinkName("asset-1", "/tmp/source.png"),
    "source.png",
  );
  assert.equal(
    resolveAssetLinkName("asset-1", "/tmp/source.png", "hero:1.png"),
    "hero_1.png",
  );
  assert.throws(
    () => resolveAssetLinkName("asset-1", "/tmp/source.png", "../bad.png"),
    /single file name/,
  );
  assert.throws(
    () => resolveAssetLinkName("asset-1", "/tmp/source.png", "nested/bad.png"),
    /single file name/,
  );
});

test("links an immutable asset into the project asset links root", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const source = join(await tempDir(), "asset.png");
  await writeFile(source, "asset-bytes", "utf8");
  await initProject({ cwd, projectId: "asset_project" });

  const result = await linkAssetIntoProject({
    assetId: "asset-1",
    cwd,
    env: {},
    homeDir,
    download: async (assetId, projectId) => {
      assert.equal(assetId, "asset-1");
      assert.equal(projectId, "asset_project");
      return source;
    },
  });

  assert.equal(result.projectId, "asset_project");
  assert.equal(result.method, "symlink");
  assert.equal(result.linkPath, join(cwd, "assets", "links", "asset.png"));
  assert.equal((await lstat(result.linkPath)).isSymbolicLink(), true);
  assert.equal(await readFile(result.linkPath, "utf8"), "asset-bytes");
});

test("asset links refuse accidental overwrite", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const source = join(await tempDir(), "asset.txt");
  await writeFile(source, "asset-bytes", "utf8");
  await initProject({ cwd, projectId: "asset_project" });

  await linkAssetIntoProject({
    assetId: "asset-1",
    cwd,
    env: {},
    homeDir,
    download: async () => source,
  });

  await assert.rejects(
    () =>
      linkAssetIntoProject({
        assetId: "asset-1",
        cwd,
        env: {},
        homeDir,
        download: async () => source,
      }),
    /already exists/,
  );
});

test("asset link copy fallback is read-only", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const source = join(await tempDir(), "asset-copy.txt");
  await writeFile(source, "asset-bytes", "utf8");
  await initProject({ cwd, projectId: "asset_project" });

  const result = await linkAssetIntoProject({
    assetId: "asset-1",
    cwd,
    env: {},
    homeDir,
    download: async () => source,
    createSymlink: () => {
      const error = new Error("symlink disabled") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    },
  });

  assert.equal(result.method, "copy");
  assert.equal(await readFile(result.linkPath, "utf8"), "asset-bytes");
  assert.equal((await stat(result.linkPath)).mode & 0o777, 0o444);
});

test("asset import sends workspace bytes through the shared Host client and links its immutable projection", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const source = join(await tempDir(), "hero.png");
  const projection = join(await tempDir(), "immutable-hero.png");
  await writeFile(source, "asset-bytes", "utf8");
  await writeFile(projection, "asset-bytes", "utf8");
  await initProject({ cwd, projectId: "asset_project" });
  const imports: unknown[] = [];

  const result = await importAssetFile({
    filePath: source,
    cwd,
    env: {},
    homeDir,
    kind: "image",
    client: {
      async importFile(input) {
        imports.push({
          ...input,
          bytes: Array.from(input.bytes),
        });
        return {
          projectId: "asset_project",
          value: {
            id: "asset:host-import",
            kind: "image",
            status: "ready",
            metadata: { bytes: 11, contentType: "image/png" },
          },
        };
      },
    } as ProjectAssetHostClient,
    download: async (assetId, projectId) => {
      assert.equal(assetId, "asset:host-import");
      assert.equal(projectId, "asset_project");
      return projection;
    },
  });

  assert.equal(result.assetId, "asset:host-import");
  assert.equal(
    result.linkPath,
    join(cwd, "assets", "links", "asset_host-import.png"),
  );
  assert.equal(result.linkMethod, "symlink");
  assert.equal((await lstat(result.linkPath!)).isSymbolicLink(), true);
  assert.equal(await readFile(result.linkPath!, "utf8"), "asset-bytes");
  assert.deepEqual(imports, [
    {
      projectId: "asset_project",
      bytes: Array.from(Buffer.from("asset-bytes")),
      fileName: "hero.png",
      contentType: "image/png",
      kind: "image",
    },
  ]);
  assert.equal(JSON.stringify(imports).includes("localBlobKey"), false);
});

test("asset import infers Director GLB files and leaves Resource deduplication to the Host", async () => {
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "asset_project" });
  const source = join(await tempDir(), "horse.glb");
  await writeFile(source, "glb-bytes", "utf8");
  let importedKind = "";

  const result = await importAssetFile({
    filePath: source,
    cwd,
    env: {},
    link: false,
    client: {
      async importFile(input) {
        importedKind = input.kind;
        return {
          projectId: "asset_project",
          value: {
            id: "asset:model",
            kind: "model",
            status: "ready",
            metadata: { bytes: 9, contentType: "model/gltf-binary" },
          },
        };
      },
    } as ProjectAssetHostClient,
  });

  assert.equal(result.registered, true);
  assert.equal(result.assetId, "asset:model");
  assert.equal(importedKind, "model");
});

test("asset replace imports a file then calls copy-on-write canvas replacement with read proof", async () => {
  const source = join(await tempDir(), "replacement.png");
  await writeFile(source, "replacement-bytes", "utf8");
  const calls: unknown[] = [];

  const result = await replaceAssetFile({
    filePath: source,
    nodeId: "node-source",
    project: "project-replace",
    kind: "image",
    ifMatch: "node-v1:read",
    newNode: "node-copy",
    label: "Replacement",
    importFile: async (options) => {
      calls.push({ importFile: options });
      return {
        projectId: "project-replace",
        assetId: "local:sha256:replacement",
        kind: "image",
        sourcePath: source,
        registered: true,
        registration: {
          id: "local:sha256:replacement",
          kind: "image",
          lifecycle: { state: "active" },
          status: "ready",
          metadata: { bytes: 17, contentType: "image/png" },
        },
      };
    },
    replaceAsset: async (options) => {
      calls.push({ replaceAsset: options });
      return {
        replaced: true,
        newNodeId: options.newNode,
        assetId: options.assetId,
      };
    },
  });

  assert.deepEqual(result, {
    importedAssetId: "local:sha256:replacement",
    replaced: true,
    replaceResult: {
      replaced: true,
      newNodeId: "node-copy",
      assetId: "local:sha256:replacement",
    },
  });
  assert.deepEqual(calls, [
    {
      importFile: {
        filePath: source,
        project: "project-replace",
        cwd: undefined,
        env: undefined,
        homeDir: undefined,
        kind: "image",
        link: true,
      },
    },
    {
      replaceAsset: {
        project: "project-replace",
        nodeId: "node-source",
        assetId: "local:sha256:replacement",
        ifMatch: "node-v1:read",
        newNode: "node-copy",
        label: "Replacement",
      },
    },
  ]);
});

test("asset get reads a ResolvedAsset from the cwd-selected Project", async () => {
  const calls: string[] = [];
  const observations: string[] = [];

  const result = await fetchProjectAssetRecord({
    projectId: "project 1",
    assetId: "local:sha256:abc/needs encoding",
    onObservation: async (receipt) => {
      observations.push(receipt);
    },
    request: async (path) => {
      calls.push(path);
      return new Response(
        JSON.stringify({
          id: "local:sha256:abc/needs encoding",
          kind: "image",
          lifecycle: { state: "active" },
          status: "ready",
          metadata: { bytes: 11, contentType: "image/png" },
        }),
        {
          status: 200,
          headers: { "x-clash-read-receipt": "project-asset:receipt:get" },
        },
      );
    },
  });

  assert.deepEqual(calls, [
    "/api/v1/projects/project%201/assets/local%3Asha256%3Aabc%2Fneeds%20encoding",
  ]);
  assert.equal(result.status, "ready");
  assert.deepEqual(observations, ["project-asset:receipt:get"]);
  assert.equal("readToken" in result, false);
});

test("asset list reads the same Project-scoped ResolvedAsset collection", async () => {
  const calls: string[] = [];
  const result = await listProjectAssetRecords({
    projectId: "project 1",
    request: async (path) => {
      calls.push(path);
      return new Response(
        JSON.stringify({
          assets: [
            {
              id: "asset:one",
              kind: "image",
              lifecycle: { state: "active" },
              status: "ready",
              metadata: { bytes: 11, contentType: "image/png" },
            },
          ],
        }),
      );
    },
  });

  assert.deepEqual(calls, ["/api/v1/projects/project%201/assets"]);
  assert.deepEqual(
    result.map(({ id }) => id),
    ["asset:one"],
  );
});

test("asset refs reads authoritative Action Asset bindings from one Project", async () => {
  const calls: string[] = [];
  const observations: string[] = [];

  const result = await fetchProjectAssetReferences({
    projectId: "project 1",
    assetId: "asset/one",
    onObservation: (receipt) => {
      observations.push(receipt);
    },
    request: async (path) => {
      calls.push(path);
      return new Response(
        JSON.stringify({
          projectAssetId: "asset/one",
          references: [
            {
              id: "binding-1",
              owner: { kind: "draft", actionId: "action-1" },
              direction: "input",
              slot: "image:0",
              projectAssetId: "asset/one",
              role: "reference",
            },
          ],
        }),
        {
          status: 200,
          headers: { "x-clash-read-receipt": "project-asset:receipt:refs" },
        },
      );
    },
  });

  assert.deepEqual(calls, [
    "/api/v1/projects/project%201/assets/asset%2Fone/references",
  ]);
  assert.equal(result.references[0]?.owner.actionId, "action-1");
  assert.deepEqual(observations, ["project-asset:receipt:refs"]);
  assert.equal("readToken" in result, false);
});

test("asset delete returns the opaque receipt through client glue and sends agent CAS headers", async () => {
  const calls: Array<{
    path: string;
    method?: string;
    headers?: RequestInit["headers"];
    body?: RequestInit["body"];
  }> = [];
  const observations: string[] = [];

  const result = await trashProjectAsset({
    projectId: "project-a",
    assetId: "asset-live",
    actorClientType: "agent",
    observedVersion: "project-asset:receipt:before-delete",
    onObservation: (receipt) => {
      observations.push(receipt);
    },
    request: async (path, init) => {
      calls.push({
        path,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
      });
      return new Response(
        JSON.stringify({
          id: "asset-live",
          kind: "image",
          lifecycle: {
            state: "trashed",
            deleteOperationId: "delete:test",
            deletedAt: "2026-08-13T00:00:00.000Z",
            purgeAfter: "2026-09-12T00:00:00.000Z",
          },
          status: "unavailable",
          metadata: { bytes: 11 },
        }),
        {
          status: 200,
          headers: {
            "x-clash-read-receipt": "project-asset:receipt:after-delete",
          },
        },
      );
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal("readToken" in result, false);
  assert.deepEqual(observations, ["project-asset:receipt:after-delete"]);
  assert.deepEqual(calls, [
    {
      path: "/api/v1/projects/project-a/assets/asset-live",
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": "project-asset:receipt:before-delete",
      },
      body: undefined,
    },
  ]);
});

test("asset restore returns the opaque receipt through client glue and sends agent CAS headers", async () => {
  const calls: Array<{
    path: string;
    method?: string;
    headers?: RequestInit["headers"];
    body?: RequestInit["body"];
  }> = [];
  const observations: string[] = [];

  const result = await restoreProjectAsset({
    projectId: "project-a",
    assetId: "asset-live",
    actorClientType: "agent",
    observedVersion: "project-asset:receipt:before-restore",
    onObservation: (receipt) => {
      observations.push(receipt);
    },
    request: async (path, init) => {
      calls.push({
        path,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
      });
      return new Response(
        JSON.stringify({
          id: "asset-live",
          kind: "image",
          lifecycle: { state: "active" },
          status: "ready",
          metadata: { bytes: 11 },
        }),
        {
          status: 200,
          headers: {
            "x-clash-read-receipt": "project-asset:receipt:after-restore",
          },
        },
      );
    },
  });

  assert.equal(result.status, "ready");
  assert.equal("readToken" in result, false);
  assert.deepEqual(observations, ["project-asset:receipt:after-restore"]);
  assert.deepEqual(calls, [
    {
      path: "/api/v1/projects/project-a/assets/asset-live/restore",
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": "project-asset:receipt:before-restore",
      },
      body: undefined,
    },
  ]);
});
