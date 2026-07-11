import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, lstat, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetsCommand,
  deleteAssetProjectRef,
  fetchAssetProjectRef,
  fetchAssetRecord,
  fetchAssetReferences,
  importAssetFile,
  linkAssetIntoProject,
  replaceAssetFile,
  resolveAssetLinkName,
  runAssetGarbageCollection,
  updateAssetCover,
} from "./assets";
import { initProject } from "./projects";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-assets-link-"));
}

test("assets command registers link subcommand", () => {
  assert.equal(assetsCommand.name(), "assets");
  assert.deepEqual(assetsCommand.commands.map((command) => command.name()), ["get", "link", "import", "replace", "cover", "ref", "refs", "gc"]);
  const get = assetsCommand.commands.find((command) => command.name() === "get");
  assert.ok(get);
  assert.ok(get.options.some((option) => option.long === "--asset"));
  const replace = assetsCommand.commands.find((command) => command.name() === "replace");
  assert.ok(replace);
  assert.ok(!replace.options.some((option) => option.long === "--if-match"));
  assert.ok(!replace.options.some((option) => option.long === "--force"));
  const cover = assetsCommand.commands.find((command) => command.name() === "cover");
  assert.ok(cover);
  assert.deepEqual(cover.commands.map((command) => command.name()), ["set"]);
  const coverSet = cover.commands.find((command) => command.name() === "set");
  assert.ok(coverSet);
  assert.ok(coverSet.options.some((option) => option.long === "--asset"));
  assert.ok(coverSet.options.some((option) => option.long === "--cover-key"));
  assert.ok(!coverSet.options.some((option) => option.long === "--if-match"));
  assert.ok(!coverSet.options.some((option) => option.long === "--force"));
  const ref = assetsCommand.commands.find((command) => command.name() === "ref");
  assert.ok(ref);
  assert.deepEqual(ref.commands.map((command) => command.name()), ["get", "delete"]);
  const refDelete = ref.commands.find((command) => command.name() === "delete");
  assert.ok(refDelete);
  assert.ok(refDelete.options.some((option) => option.long === "--asset"));
  assert.ok(refDelete.options.some((option) => option.long === "--project"));
  assert.ok(!refDelete.options.some((option) => option.long === "--if-match"));
  assert.ok(!refDelete.options.some((option) => option.long === "--force"));
  assert.ok(refDelete.options.some((option) => option.long === "--yes"));
  const refs = assetsCommand.commands.find((command) => command.name() === "refs");
  assert.ok(refs);
  assert.ok(refs.options.some((option) => option.long === "--asset"));
  assert.ok(refs.options.some((option) => option.long === "--project"));
  assert.ok(refs.options.some((option) => option.long === "--refresh"));
  assert.ok(!refs.options.some((option) => option.long === "--if-match"));
  const gc = assetsCommand.commands.find((command) => command.name() === "gc");
  assert.ok(gc);
  assert.ok(!gc.options.some((option) => option.long === "--if-match"));
  assert.ok(!gc.options.some((option) => option.long === "--force"));
});

test("asset link names must stay inside the project asset links directory", () => {
  assert.equal(resolveAssetLinkName("asset-1", "/tmp/source.png"), "source.png");
  assert.equal(resolveAssetLinkName("asset-1", "/tmp/source.png", "hero:1.png"), "hero_1.png");
  assert.throws(() => resolveAssetLinkName("asset-1", "/tmp/source.png", "../bad.png"), /single file name/);
  assert.throws(() => resolveAssetLinkName("asset-1", "/tmp/source.png", "nested/bad.png"), /single file name/);
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
    download: async () => source,
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
    () => linkAssetIntoProject({
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

test("imports a local file as a content-addressed immutable asset with a project link", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const source = join(await tempDir(), "hero.png");
  await writeFile(source, "asset-bytes", "utf8");
  await initProject({ cwd, projectId: "asset_project" });
  const hash = createHash("sha256").update("asset-bytes").digest("hex");

  const result = await importAssetFile({
    filePath: source,
    cwd,
    env: {},
    homeDir,
    kind: "image",
  });

  assert.equal(result.assetId, `local:sha256:${hash}`);
  assert.equal(result.contentHash, hash);
  assert.equal(result.blobPath, join(homeDir, ".clash", "assets", "blobs", hash, "original.png"));
  assert.equal(result.linkPath, join(cwd, "assets", "links", `local_sha256_${hash}.png`));
  assert.equal(result.linkMethod, "symlink");
  assert.equal(result.deduplicated, false);
  assert.equal(await readFile(result.blobPath, "utf8"), "asset-bytes");
  assert.equal((await stat(result.blobPath)).mode & 0o777, 0o444);
  assert.equal((await lstat(result.linkPath!)).isSymbolicLink(), true);
  assert.equal(await readFile(result.linkPath!, "utf8"), "asset-bytes");
});

test("asset import deduplicates identical content in the global blob store", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "asset_project" });
  const sourceA = join(await tempDir(), "a.txt");
  const sourceB = join(await tempDir(), "b.txt");
  await writeFile(sourceA, "same-bytes", "utf8");
  await writeFile(sourceB, "same-bytes", "utf8");

  const first = await importAssetFile({
    filePath: sourceA,
    cwd,
    env: {},
    homeDir,
    link: false,
  });
  const second = await importAssetFile({
    filePath: sourceB,
    cwd,
    env: {},
    homeDir,
    link: false,
  });

  assert.equal(second.assetId, first.assetId);
  assert.equal(second.blobPath, first.blobPath);
  assert.equal(second.deduplicated, true);
});

test("asset import can register the content-addressed blob with local metadata", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  await initProject({ cwd, projectId: "asset_project" });
  const source = join(await tempDir(), "hero.png");
  await writeFile(source, "asset-bytes", "utf8");
  const hash = createHash("sha256").update("asset-bytes").digest("hex");
  const registrations: unknown[] = [];

  const result = await importAssetFile({
    filePath: source,
    cwd,
    env: {},
    homeDir,
    kind: "image",
    link: false,
    registerImportedAsset: async (payload) => {
      registrations.push(payload);
      return { id: payload.assetId, srcR2Key: `local-blobs/${hash}/original.png` };
    },
  });

  assert.equal(result.registered, true);
  assert.deepEqual(registrations, [{
    projectId: "asset_project",
    kind: "image",
    assetId: `local:sha256:${hash}`,
    contentHash: hash,
    localBlobKey: `blobs/${hash}/original.png`,
    bytes: 11,
    contentType: "image/png",
    originalName: "hero.png",
  }]);
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
        contentHash: "replacement",
        sourcePath: source,
        blobPath: "/tmp/blob.png",
        deduplicated: false,
        registered: true,
      };
    },
    replaceAsset: async (options) => {
      calls.push({ replaceAsset: options });
      return { replaced: true, newNodeId: options.newNode, assetId: options.assetId };
    },
  });

  assert.deepEqual(result, {
    importedAssetId: "local:sha256:replacement",
    replaced: true,
    replaceResult: { replaced: true, newNodeId: "node-copy", assetId: "local:sha256:replacement" },
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
        registerImportedAsset: undefined,
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

test("asset gc calls the local metadata garbage collector explicitly", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];

  const result = await runAssetGarbageCollection({
    dryRun: false,
    request: async (path, init) => {
      calls.push({
        path,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({
        dryRun: false,
        deletedAssets: [{ id: "asset-orphan", srcR2Key: "local-blobs/hash/original.png" }],
        deletedBlobKeys: ["local-blobs/hash/original.png"],
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, [{ path: "/api/v1/assets/gc", body: { dryRun: false } }]);
  assert.deepEqual(result.deletedBlobKeys, ["local-blobs/hash/original.png"]);
});

test("asset gc can pass protected canvas asset ids to the host", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];

  await runAssetGarbageCollection({
    dryRun: false,
    protectedAssetIds: ["asset-live"],
    request: async (path, init) => {
      calls.push({
        path,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({
        dryRun: false,
        protectedAssets: ["asset-live"],
        deletedAssets: [],
        deletedBlobKeys: [],
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, [{
    path: "/api/v1/assets/gc",
    body: { dryRun: false, protectedAssetIds: ["asset-live"] },
  }]);
});

test("asset gc can ask the host to scan project canvas references", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];

  await runAssetGarbageCollection({
    dryRun: false,
    projectIds: ["project-loro-ref"],
    request: async (path, init) => {
      calls.push({
        path,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({
        dryRun: false,
        protectedProjectIds: ["project-loro-ref"],
        protectedAssets: ["asset-live"],
        deletedAssets: [],
        deletedBlobKeys: [],
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, [{
    path: "/api/v1/assets/gc",
    body: { dryRun: false, projectIds: ["project-loro-ref"] },
  }]);
});

test("asset gc delete can pass an agent dry-run receipt back to the host", async () => {
  const calls: Array<{ path: string; headers: Record<string, string>; body: unknown }> = [];

  await runAssetGarbageCollection({
    dryRun: false,
    ifMatch: "asset-gc-v1:read:receipt:signed",
    env: { CLASH_AGENT_MEMBER_ID: "agent-member-1" },
    request: async (path, init) => {
      calls.push({
        path,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({
        dryRun: false,
        deletedAssets: [],
        deletedBlobKeys: [],
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, [{
    path: "/api/v1/assets/gc",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": "asset-gc-v1:read:receipt:signed",
    },
    body: { dryRun: false },
  }]);
});

test("asset refs reads node references through the host API", async () => {
  const calls: string[] = [];

  const result = await fetchAssetReferences({
    assetId: "local:sha256:abc/needs encoding",
    projectId: "project 1",
    request: async (path) => {
      calls.push(path);
      return new Response(JSON.stringify({
        assetId: "local:sha256:abc/needs encoding",
        references: [
          {
            assetId: "local:sha256:abc/needs encoding",
            projectId: "project 1",
            nodeId: "node-a",
            nodeType: "image",
            fieldPath: "data.assetId",
            referenceRole: "primary",
          },
        ],
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, ["/api/v1/assets/local%3Asha256%3Aabc%2Fneeds%20encoding/references?projectId=project%201"]);
  assert.equal(result.references[0]?.fieldPath, "data.assetId");
  assert.equal(result.references[0]?.referenceRole, "primary");
});

test("asset refs can explicitly refresh indexed references through the host API", async () => {
  const calls: Array<{ path: string; method?: string; headers?: Record<string, string>; body: unknown }> = [];

  const result = await fetchAssetReferences({
    assetId: "asset-live",
    projectId: "project-refresh",
    refresh: true,
    ifMatch: "asset-v1:abc:receipt:host-proof",
    env: { CLASH_AGENT_MEMBER_ID: "agent-1" },
    request: async (path, init) => {
      calls.push({
        path,
        method: init?.method,
        headers: init?.headers as Record<string, string> | undefined,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({
        assetId: "asset-live",
        refreshed: true,
        protectedProjectIds: ["project-refresh"],
        references: [
          {
            assetId: "asset-live",
            projectId: "project-refresh",
            nodeId: "node-a",
            nodeType: "image",
            fieldPath: "data.assetId",
            referenceRole: "primary",
          },
        ],
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, [{
    path: "/api/v1/assets/asset-live/references/refresh",
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": "asset-v1:abc:receipt:host-proof",
    },
    body: { projectIds: ["project-refresh"] },
  }]);
  assert.equal(result.references[0]?.referenceRole, "primary");
});

test("asset get reads an asset row and receipt token through the host API", async () => {
  const calls: string[] = [];

  const result = await fetchAssetRecord({
    assetId: "local:sha256:abc/needs encoding",
    request: async (path) => {
      calls.push(path);
      return new Response(JSON.stringify({
        id: "local:sha256:abc/needs encoding",
        kind: "image",
        srcR2Key: "uploads/source.png",
        readToken: "asset-v1:read:receipt:signed",
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, ["/api/v1/assets/local%3Asha256%3Aabc%2Fneeds%20encoding"]);
  assert.equal(result.readToken, "asset-v1:read:receipt:signed");
});

test("asset cover set passes agent read proof to the host API", async () => {
  const calls: Array<{ path: string; method?: string; headers: Record<string, string> | undefined; body: unknown }> = [];

  const result = await updateAssetCover({
    assetId: "asset-live",
    coverR2Key: "uploads/cover.png",
    ifMatch: "asset-v1:read:receipt:signed",
    env: { CLASH_AGENT_MEMBER_ID: "agent-1" },
    request: async (path, init) => {
      calls.push({
        path,
        method: init?.method,
        headers: init?.headers as Record<string, string> | undefined,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({
        ok: true,
        readToken: "asset-v1:after:receipt:signed",
        mutation: {
          operation: "asset_cover_update",
          entity: { kind: "asset", id: "asset-live" },
          expectedReadToken: "asset-v1:read:receipt:signed",
          beforeReadToken: "asset-v1:read",
          afterReadToken: "asset-v1:after:receipt:signed",
          accepted: true,
        },
      }), { status: 200 });
    },
  });

  assert.equal(result.readToken, "asset-v1:after:receipt:signed");
  assert.deepEqual(calls, [{
    path: "/api/v1/assets/asset-live/cover",
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": "asset-v1:read:receipt:signed",
    },
    body: { coverR2Key: "uploads/cover.png" },
  }]);
});

test("asset ref get reads the project membership relation through the host API", async () => {
  const calls: string[] = [];

  const result = await fetchAssetProjectRef({
    assetId: "local:sha256:abc/needs encoding",
    projectId: "project 1",
    request: async (path) => {
      calls.push(path);
      return new Response(JSON.stringify({
        assetId: "local:sha256:abc/needs encoding",
        projectId: "project 1",
        importedAt: 123,
        readToken: "asset-ref-v1:read:receipt:signed",
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, ["/api/v1/assets/local%3Asha256%3Aabc%2Fneeds%20encoding/ref?projectId=project%201"]);
  assert.equal(result.readToken, "asset-ref-v1:read:receipt:signed");
});

test("asset ref delete passes agent read proof to the host API", async () => {
  const calls: Array<{ path: string; method?: string; headers: Record<string, string> | undefined }> = [];

  const result = await deleteAssetProjectRef({
    assetId: "asset-live",
    projectId: "project-a",
    ifMatch: "asset-ref-v1:read:receipt:signed",
    env: { CLASH_AGENT_MEMBER_ID: "agent-1" },
    request: async (path, init) => {
      calls.push({
        path,
        method: init?.method,
        headers: init?.headers as Record<string, string> | undefined,
      });
      return new Response(JSON.stringify({
        deleted: true,
        mutation: {
          operation: "asset_ref_delete",
          entity: { kind: "asset-ref", id: "asset-live:project-a" },
          expectedReadToken: "asset-ref-v1:read:receipt:signed",
          beforeReadToken: "asset-ref-v1:read",
          accepted: true,
        },
      }), { status: 200 });
    },
  });

  assert.equal(result.deleted, true);
  assert.deepEqual(calls, [{
    path: "/api/v1/assets/asset-live/ref?projectId=project-a",
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": "asset-ref-v1:read:receipt:signed",
    },
  }]);
});
