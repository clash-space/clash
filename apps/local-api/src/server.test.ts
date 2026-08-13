import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  createDurableRunRecord,
} from "@clash/shared-runtime";
import { projectAssetAuthorityVersion } from "@clash/shared-types";
import { readHostDiscovery } from "./host-discovery";
import {
  createConfiguredLocalAcpAdapter,
  bootstrapLocalDurableRunRecovery,
  createLocalAgentToolEnv,
  createLocalPluginBrokerServices,
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
  startLocalApiServer,
} from "./server";
import * as serverModule from "./server";
import { createLocalAudioConfigStore } from "./audio-config";
import { createLocalMetadataStore } from "./local-metadata-store";
import { createLocalPluginAssetStagingStore } from "./local-plugin-asset-staging";
import type { LocalProjectAssetReplica } from "./local-project-assets";
import { createClashUserConfigStore } from "./user-config";
import { createSqliteDurableRunJournal } from "./durable-run-journal";

const execFileAsync = promisify(execFile);

async function withLocalDataDir<T>(
  dataDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.CLASH_LOCAL_DATA_DIR;
  process.env.CLASH_LOCAL_DATA_DIR = dataDir;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.CLASH_LOCAL_DATA_DIR;
    } else {
      process.env.CLASH_LOCAL_DATA_DIR = previous;
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function listenOnLoopback(
  server: ReturnType<typeof createServer>,
  port = 0,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      if (errorCode(error) === "EPERM") {
        resolve(null);
        return;
      }
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("failed to reserve port"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("local API server configuration", () => {
  it("reopens journal-owned Projects for recovery without waiting for a client visit", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-startup-recovery-"));
    try {
      const journal = createSqliteDurableRunJournal(dataDir);
      for (const [actionRunId, projectId] of [
        ["run-project-b", "project-b"],
        ["run-project-a", "project-a"],
        ["run-project-a-second", "project-a"],
      ] as const) {
        await journal.create(
          createDurableRunRecord({
            actionRunId,
            outputSlot: "media",
            owner: { realm: "local", id: "local-api" },
            executorInput: { projectId },
            createdAt: 1,
            deadlineAt: 10_000,
          }),
        );
      }
      const opened: string[] = [];

      await expect(
        bootstrapLocalDurableRunRecovery({
          dataDir,
          ownerId: "local-api",
          roomHub: {
            async room(projectId) {
              opened.push(projectId);
              return {} as never;
            },
          },
        }),
      ).resolves.toEqual(["project-a", "project-b"]);
      expect(opened).toEqual(["project-a", "project-b"]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("advances a journaled run after daemon start without a Project request", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-startup-recovery-boundary-"),
    );
    const journal = createSqliteDurableRunJournal(dataDir);
    const identity = {
      actionRunId: "restart-without-client",
      outputSlot: "media",
    };
    await journal.create(
      createDurableRunRecord({
        ...identity,
        owner: { realm: "local", id: "local-api" },
        executorInput: {
          schemaVersion: 1,
          binding: {
            pluginId: "missing.restart-provider",
            version: "1.0.0",
            exportId: "generate",
            schemaHash: `sha256:${"0".repeat(64)}`,
          },
          accountId: "account-restart",
          kind: "image",
          projectId: "project-restart",
          input: { values: {}, references: [] },
        },
        createdAt: Date.now(),
        deadlineAt: Date.now() + 30 * 60_000,
      }),
    );
    let server: Awaited<ReturnType<typeof startLocalApiServer>> | undefined;

    try {
      server = await withLocalDataDir(dataDir, () =>
        startLocalApiServer({
          dataDir,
          port: 0,
          remotePersistence: null,
          discovery: { enabled: false },
          localAcp: createConfiguredLocalAcpAdapter({
            CLASH_E2E_STUB_ACP: "1",
          }),
        }),
      );

      const deadline = Date.now() + 15_000;
      let recovered = await journal.load(identity);
      while ((recovered?.revision ?? 0) === 0 && Date.now() < deadline) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
        recovered = await journal.load(identity);
      }
      expect(recovered).toMatchObject({
        actionRunId: identity.actionRunId,
        outputSlot: identity.outputSlot,
        owner: { realm: "local", id: "local-api" },
      });
      expect(recovered!.revision).toBeGreaterThan(0);
      expect(recovered!.phase).not.toBe("queued");
    } finally {
      if (server) {
        await new Promise<void>((resolveClose) =>
          server!.close(() => resolveClose()),
        );
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("materializes plugin Asset reads through the supplied Project replica", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-plugin-live-replica-"));
    try {
      const projectId = "project-live-replica";
      const assetId = "legacy-live-asset";
      const bytes = new TextEncoder().encode("legacy plugin input");
      const digest = createHash("sha256").update(bytes).digest("hex");
      const storageKey = "generated/live-input.png";
      await mkdir(join(dataDir, "assets", "generated"), { recursive: true });
      await writeFile(join(dataDir, "assets", storageKey), bytes);
      const metadata = createLocalMetadataStore(dataDir);
      const legacy = await metadata.load();
      legacy.assets.push({
        id: assetId,
        userId: "local-user",
        projectId,
        kind: "image",
        srcR2Key: storageKey,
        coverR2Key: null,
        metadata: {
          bytes: bytes.byteLength,
          contentHash: digest,
          contentType: "image/png",
          originalName: "live-input.png",
        },
        sourceModel: null,
        sourcePrompt: null,
        sourceTaskId: null,
        sources: null,
        createdAt: 1,
        updatedAt: 1,
      });
      legacy.assetRefs.push({
        assetId,
        projectId,
        importedAt: 1,
      });
      await metadata.save(legacy, {
        replaceLegacyAssetMigrationInput: true,
      });

      const liveDoc = new LoroDoc();
      const projectAssetReplica: LocalProjectAssetReplica = {
        inspect: async (_id, read) => read(liveDoc),
        mutate: async (_id, mutation) => (await mutation(liveDoc)).value,
      };
      const brokerOptions = {
        dataDir,
        uploadOrigin: "http://127.0.0.1:8787",
        projectAssetReplica,
      } as Parameters<typeof createLocalPluginBrokerServices>[0] & {
        projectAssetReplica: LocalProjectAssetReplica;
      };
      const broker = createLocalPluginBrokerServices(brokerOptions);

      await expect(
        broker(
          {
            protocol: "clash.plugin.broker-request/v1",
            requestId: "read-live-asset",
            invocationId: "invocation-live-asset",
            operation: {
              kind: "asset.resolve",
              reference: {
                slot: "image",
                index: 0,
                asset: {
                  assetId,
                  uri: `clash-asset://${assetId}`,
                  kind: "image",
                },
              },
            },
          },
          {
            manifest: {
              apiVersion: "clash.plugin/v1",
              id: "test.live-reader",
              version: "1.0.0",
              name: "Live reader",
              runtime: {
                kind: "local",
                transport: "stdio",
                entrypoint: "handler.mjs",
                args: [],
              },
              contractTests: [],
              contributes: {
                cards: [],
                providers: [],
                modelBindings: [],
                functions: [
                  {
                    id: "run",
                    kind: "action",
                    operations: ["submit"],
                  },
                ],
                hostTools: [],
              },
            },
            invocation: {
              protocol: "clash.plugin.invoke/v1",
              invocationId: "invocation-live-asset",
              taskId: "task-live-asset",
              projectId,
              target: {
                pluginId: "test.live-reader",
                version: "1.0.0",
                exportId: "run",
                schemaHash: `sha256:${"e".repeat(64)}`,
                kind: "action",
              },
              input: {
                values: {},
                references: [{
                  slot: "image",
                  index: 0,
                  asset: {
                    assetId,
                    uri: `clash-asset://${assetId}`,
                    kind: "image",
                  },
                }],
              },
              assetInputs: [{
                match: { kinds: ["image"], slots: ["image"] },
                representations: ["bytes"],
              }],
              actor: { kind: "agent", id: "agent-live" },
              operation: "submit",
            },
          },
        ),
      ).resolves.toMatchObject({
        form: "bytes",
        kind: "image",
        bytesBase64: Buffer.from(bytes).toString("base64"),
      });
      expect(projectAssetAuthorityVersion(liveDoc)).toBe(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("delivers reference bytes when public Asset storage is explicitly unavailable", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-plugin-private-reference-"));
    try {
      const projectId = "project-private-reference";
      const staging = createLocalPluginAssetStagingStore({
        dataDir,
        clashRoot: clashHomeForLocalDataDir(dataDir),
      });
      const staged = await staging.stage({
        projectId,
        taskId: "reference-import",
        slot: "image",
        pluginId: "test.reference-import",
        pluginVersion: "1.0.0",
        invocationId: "reference-import-1",
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      });
      const publish = vi.fn(async () => {
        throw new Error("disabled public storage must not be called");
      });
      const publicAssetStorage = {
        getPublicConfig: async () => ({
          capability: "public-asset-storage" as const,
          mode: "disabled" as const,
          available: false,
          provider: null,
          account_id: null,
          endpoint: null,
          bucket: null,
          region: null,
          key_prefix: "clash-temporary",
          force_path_style: false,
          has_access_key_id: false,
          has_secret_access_key: false,
          has_session_token: false,
          managed: { available: false, authenticated: false },
        }),
        publish,
        updateFromRequest: async () => {
          throw new Error("not used");
        },
        testConnection: async () => {
          throw new Error("not used");
        },
        delete: async () => {
          throw new Error("not used");
        },
      } satisfies NonNullable<Parameters<typeof createLocalPluginBrokerServices>[0]["publicAssetStorage"]>;
      const broker = createLocalPluginBrokerServices({
        dataDir,
        assetStaging: staging,
        publicAssetStorage,
      });

      await expect(broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "private-reference-1",
          invocationId: "private-reference-invocation",
          operation: {
            kind: "asset.resolve",
            reference: {
              slot: "image",
              index: 0,
              asset: {
                assetId: staged.projectAssetId,
                uri: `clash-asset://${staged.projectAssetId}`,
                kind: "image",
                mediaType: "image/png",
              },
            },
          },
        },
        {
          manifest: {
            apiVersion: "clash.plugin/v1",
            id: "test.reference-reader",
            version: "1.0.0",
            name: "Reference reader",
            runtime: {
              kind: "local",
              transport: "stdio",
              entrypoint: "handler.mjs",
              args: [],
            },
            contractTests: [],
            contributes: {
              cards: [],
              providers: [],
              modelBindings: [],
              functions: [{
                id: "run",
                kind: "provider-executor",
                operations: ["submit"],
              }],
              hostTools: [],
            },
          },
          invocation: {
            protocol: "clash.plugin.invoke/v1",
            invocationId: "private-reference-invocation",
            taskId: "private-reference-task",
            projectId,
            target: {
              pluginId: "test.reference-reader",
              version: "1.0.0",
              exportId: "run",
              schemaHash: `sha256:${"f".repeat(64)}`,
              kind: "provider-executor",
            },
            input: { values: {}, references: [] },
            assetInputs: [{
              match: { kinds: ["image"] },
              representations: ["provider-url", "bytes"],
            }],
            actor: { kind: "system" },
            operation: "submit",
          },
        },
      )).resolves.toMatchObject({
        form: "bytes",
        bytesBase64: "AQID",
        kind: "image",
        mediaType: "image/png",
      });
      expect(publish).not.toHaveBeenCalled();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists plugin asset writes as immutable project-scoped Clash assets", async () => {
    const createBroker = (serverModule as Record<string, unknown>)
      .createLocalPluginBrokerServices as
      | ((options: { dataDir: string; uploadOrigin?: string }) => any)
      | undefined;
    expect(createBroker).toBeDefined();
    if (!createBroker) return;
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-plugin-output-"));
    const broker = createBroker({
      dataDir,
      uploadOrigin: "http://127.0.0.1:8787",
    });
    const context = {
      manifest: {
        apiVersion: "clash.plugin/v1",
        id: "test.asset-writer-plugin",
        version: "1.0.0",
        name: "Asset Writer Plugin",
        runtime: {
          kind: "local",
          transport: "stdio",
          entrypoint: "handler.mjs",
        },
        contributes: {
          cards: [],
          providers: [],
          modelBindings: [],
          functions: [{ id: "run", kind: "provider-executor" as const }],
        },
      },
      invocation: {
        protocol: "clash.plugin.invoke/v1",
        invocationId: "invocation-output-1",
        taskId: "task-output-1",
        projectId: "project-output-1",
        target: {
          pluginId: "test.asset-writer-plugin",
          version: "1.0.0",
          exportId: "write",
          schemaHash: `sha256:${"c".repeat(64)}`,
          kind: "action",
        },
        input: { values: {}, references: [] },
        actor: { kind: "agent", id: "agent-1" },
      },
    };
    const output = (await broker(
      {
        protocol: "clash.plugin.broker-request/v1",
        requestId: "asset-output-1",
        invocationId: "invocation-output-1",
        operation: {
          kind: "asset.write",
          slot: "image",
          assetKind: "image",
          mediaType: "image/png",
          dataBase64: "AQID",
        },
      },
      context,
    )) as {
      assetId: string;
      uri: string;
      url?: string;
      reach?: string;
    };

    expect(output.uri).toBe(`clash-asset://${output.assetId}`);
    expect(output.assetId).toMatch(/^plugin-output:[a-f0-9]{64}$/);
    expect(output).not.toHaveProperty("url");
    expect(output).not.toHaveProperty("reach");
    const staged = await createLocalPluginAssetStagingStore({
      dataDir,
      clashRoot: clashHomeForLocalDataDir(dataDir),
    }).resolve({
      projectId: "project-output-1",
      projectAssetId: output.assetId,
    });
    expect(staged).toMatchObject({
      projectAssetId: output.assetId,
      projectId: "project-output-1",
      pluginId: "test.asset-writer-plugin",
      pluginVersion: "1.0.0",
      taskId: "task-output-1",
      kind: "image",
      mediaType: "image/png",
      projection: {
        resource: { kind: "image", byteLength: 3, contentType: "image/png" },
      },
    });
    await expect(readFile(staged!.projection.path)).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
    const metadata = await createLocalMetadataStore(dataDir).load();
    expect(metadata.assets).toEqual([]);
    expect(metadata.assetRefs).toEqual([]);
  });

  it("stores a provider URL before returning its asset handle to a third-party plugin", async () => {
    const createBroker = (serverModule as Record<string, unknown>)
      .createLocalPluginBrokerServices as
      | ((options: {
          dataDir: string;
          assetFetch: typeof fetch;
          uploadOrigin?: string;
        }) => any)
      | undefined;
    expect(createBroker).toBeDefined();
    if (!createBroker) return;

    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-local-plugin-url-output-"),
    );
    try {
      const assetFetch = vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "video/mp4" },
          }),
      );
      const broker = createBroker({
        dataDir,
        assetFetch,
        uploadOrigin: "http://127.0.0.1:8787",
      });
      const output = (await broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "asset-url-1",
          invocationId: "invocation-url-1",
          operation: {
            kind: "asset.upload-slot",
            slot: "media",
            assetKind: "video",
            mediaType: "video/mp4",
            url: "https://cdn.example.test/output.mp4",
          },
        },
        {
          manifest: {
            apiVersion: "clash.plugin/v1",
            id: "third-party.video-plugin",
            version: "2.1.0",
            name: "Third-party Video Plugin",
            runtime: {
              kind: "local",
              transport: "stdio",
              entrypoint: "handler.mjs",
            },
            contributes: {
              cards: [],
              providers: [],
              modelBindings: [],
              functions: [{ id: "run", kind: "provider-executor" }],
            },
          },
          invocation: {
            protocol: "clash.plugin.invoke/v1",
            invocationId: "invocation-url-1",
            taskId: "task-url-1",
            projectId: "project-url-1",
            target: {
              pluginId: "third-party.video-plugin",
              version: "2.1.0",
              exportId: "run",
              schemaHash: `sha256:${"d".repeat(64)}`,
              kind: "provider-executor",
            },
            input: { values: {}, references: [] },
            actor: { kind: "system", id: "test" },
          },
        },
      )) as {
        assetId: string;
        uri: string;
        kind: string;
        mediaType?: string;
        url?: string;
        reach?: string;
      };

      expect(output).toMatchObject({
        assetId: expect.not.stringMatching(/^upload-/),
        uri: `clash-asset://${output.assetId}`,
        kind: "video",
        mediaType: "video/mp4",
      });
      expect(output.assetId).toMatch(/^plugin-output:[a-f0-9]{64}$/);
      expect(output).not.toHaveProperty("url");
      expect(output).not.toHaveProperty("reach");
      expect(assetFetch).toHaveBeenCalledWith(
        "https://cdn.example.test/output.mp4",
      );
      const staged = await createLocalPluginAssetStagingStore({
        dataDir,
        clashRoot: clashHomeForLocalDataDir(dataDir),
      }).resolve({
        projectId: "project-url-1",
        projectAssetId: output.assetId,
      });
      expect(staged).toMatchObject({
        projectAssetId: output.assetId,
        projectId: "project-url-1",
        pluginId: "third-party.video-plugin",
        pluginVersion: "2.1.0",
        taskId: "task-url-1",
        kind: "video",
        mediaType: "video/mp4",
        projection: {
          resource: { kind: "video", byteLength: 3, contentType: "video/mp4" },
        },
      });
      const metadata = await createLocalMetadataStore(dataDir).load();
      expect(metadata.assets).toEqual([]);
      expect(metadata.assetRefs).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps package scripts local and leaves dependency orchestration to the root", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    const scripts = packageJson.scripts ?? {};

    expect(scripts["build:deps"]).toBeUndefined();
    expect(scripts["build:with-deps"]).toBeUndefined();
    expect(scripts.build).toBe("tsc");
    expect(scripts.typecheck).toBe("tsc --noEmit");
    expect(scripts.test).toBe("vitest run src");
    expect(scripts["test:e2e"]).toBe(
      "tsx --tsconfig tsconfig.dev.json e2e/daemon-smoke.ts",
    );
  });

  it("uses CLASH_HOME for the default local data dir when CLASH_LOCAL_DATA_DIR is absent", () => {
    expect(
      defaultLocalApiDataDir({
        CLASH_HOME: "/tmp/clash-home",
      }),
    ).toBe(join("/tmp/clash-home", "local-api"));
    expect(
      defaultLocalApiDataDir({
        CLASH_HOME: "/tmp/clash-home",
        CLASH_LOCAL_DATA_DIR: "/tmp/explicit-local-api",
      }),
    ).toBe("/tmp/explicit-local-api");
    expect(
      defaultLocalApiDataDir({
        CLASH_LOCAL_DATA_DIR: "./relative-local-api",
      }),
    ).toBe(resolve("./relative-local-api"));
  });

  it("uses the server data directory as the ACP lifecycle directory", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-root-"));
    const dataDir = join(clashRoot, "local-api");
    const acpBinDir = join(dataDir, "acp-bin");
    await mkdir(acpBinDir, { recursive: true });
    const codexShim = join(acpBinDir, "codex-acp");
    await writeFile(codexShim, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(codexShim, 0o755);

    const adapter = createConfiguredLocalAcpAdapter({ PATH: "" }, { dataDir });

    await expect(adapter.listRuntimes()).resolves.toMatchObject({
      runtimes: [
        {
          agents: expect.arrayContaining([
            expect.objectContaining({
              id: "codex-acp",
              binary: codexShim,
            }),
          ]),
        },
      ],
    });
  });

  it("rejects when the requested listen port is occupied", async () => {
    const blocker = createServer();
    const occupiedPort = await listenOnLoopback(blocker);
    if (occupiedPort === null) return;

    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-port-"));

    try {
      await withLocalDataDir(dataDir, async () => {
        await expect(
          startLocalApiServer({
            dataDir,
            port: occupiedPort,
            remotePersistence: null,
          }),
        ).rejects.toMatchObject({ code: "EADDRINUSE" });
      });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("writes a discovery record after listen and removes it on close", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-data-"));
    const runDir = await mkdtemp(join(tmpdir(), "clash-local-api-run-"));
    let server: Awaited<ReturnType<typeof startLocalApiServer>>;
    try {
      server = await withLocalDataDir(dataDir, () =>
        startLocalApiServer({
          dataDir,
          port: 0,
          remotePersistence: null,
          discovery: {
            enabled: true,
            runDir,
            launchMode: "desktop",
            ownerClientId: "desktop-1",
            startedBy: "desktop",
          },
        }),
      );
    } catch (error) {
      if (errorCode(error) === "EPERM") return;
      throw error;
    }

    const discovery = await readHostDiscovery({ runDir });
    expect(discovery.status).toBe("active");
    if (discovery.status !== "active")
      throw new Error("expected active discovery record");
    expect(discovery.record).toMatchObject({
      endpoint: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      agentCliPath: join(dataDir, "agent-bin", "clash"),
      launchMode: "desktop",
      ownerClientId: "desktop-1",
      pid: process.pid,
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    });
    const health = await fetch(new URL("/health", discovery.record.endpoint));
    expect(await health.json()).toMatchObject({
      ok: true,
      mode: "local",
      host: {
        hostId: discovery.record.hostId,
        pid: discovery.record.pid,
        profile: discovery.record.profile,
        protocolVersion: discovery.record.protocolVersion,
      },
    });
    const shimText = await readFile(
      join(dataDir, "agent-bin", "clash"),
      "utf8",
    );
    expect(shimText).toContain(`CLASH_API_URL='${discovery.record.endpoint}'`);
    expect(shimText).not.toContain("CLASH_API_URL='http://127.0.0.1:0'");

    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => (error ? reject(error) : resolve()));
    });

    await expect(readHostDiscovery({ runDir })).resolves.toEqual({
      status: "inactive",
    });
  });

  it("starts the configured voice readiness probe without blocking server listen", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "clash-local-api-voice-warmup-"),
    );
    await createClashUserConfigStore(dataDir).setSection("audio", {
      asr: {
        enabled: true,
        provider: "builtin-funasr",
        model: "iic/SenseVoiceSmall",
      },
      tts: {
        enabled: false,
        provider: "builtin-piper",
        model: "zh_CN-huayan-medium",
      },
    });

    let resolveStatus!: (status: { available: boolean }) => void;
    const builtinStatus = vi.fn(
      () =>
        new Promise<{ available: boolean }>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const audioConfig = createLocalAudioConfigStore({ dataDir, builtinStatus });
    let server: Awaited<ReturnType<typeof startLocalApiServer>> | undefined;

    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        audioConfig,
        localAcp: createConfiguredLocalAcpAdapter({ CLASH_E2E_STUB_ACP: "1" }),
      });
      await vi.waitFor(() => expect(builtinStatus).toHaveBeenCalledTimes(1));
    } finally {
      resolveStatus?.({ available: true });
      if (server) {
        await new Promise<void>((resolveClose) =>
          server!.close(() => resolveClose()),
        );
      }
    }
  });

  it("keeps default host discovery beside the configured local-api data directory", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-root-"));
    const unrelatedClashHome = await mkdtemp(
      join(tmpdir(), "clash-unrelated-home-"),
    );
    const dataDir = join(clashRoot, "local-api");
    const runDir = join(clashRoot, "run");
    const previousClashHome = process.env.CLASH_HOME;
    process.env.CLASH_HOME = unrelatedClashHome;
    let server: Awaited<ReturnType<typeof startLocalApiServer>> | undefined;

    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        localAcp: createConfiguredLocalAcpAdapter({ CLASH_E2E_STUB_ACP: "1" }),
        discovery: {
          enabled: true,
          launchMode: "desktop",
          ownerClientId: "desktop-canonical-root",
          startedBy: "desktop",
        },
      });

      await expect(readHostDiscovery({ runDir })).resolves.toMatchObject({
        status: "active",
        record: {
          ownerClientId: "desktop-canonical-root",
          agentCliPath: join(dataDir, "agent-bin", "clash"),
        },
      });
    } finally {
      if (server) {
        await new Promise<void>((resolveClose) =>
          server!.close(() => resolveClose()),
        );
      }
      if (previousClashHome === undefined) {
        delete process.env.CLASH_HOME;
      } else {
        process.env.CLASH_HOME = previousClashHome;
      }
    }

    await expect(readHostDiscovery({ runDir })).resolves.toEqual({
      status: "inactive",
    });
  });

  it("waits for local ACP disposal before completing server close", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-shutdown-"));
    let releaseDispose!: () => void;
    const disposeGate = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const disposeAll = vi.fn(async () => disposeGate);
    const localAcp = {
      updateSpawnEnv() {},
      async listRuntimes() {
        return { runtimes: [] };
      },
      async createSession() {
        return { session_id: "unused" };
      },
      async listResumeSessions() {
        return { sessions: [] };
      },
      disposeAll,
    };
    let server: Awaited<ReturnType<typeof startLocalApiServer>>;
    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        localAcp: localAcp as never,
      });
    } catch (error) {
      if (errorCode(error) === "EPERM") return;
      throw error;
    }

    let closeSettled = false;
    const closing = new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        closeSettled = true;
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const settledBeforeDispose = closeSettled;
    releaseDispose();
    await closing;

    expect(disposeAll).toHaveBeenCalledOnce();
    expect(settledBeforeDispose).toBe(false);
  });

  it("observes config.yaml edits made while ACP warmup is still running", async () => {
    const clashHome = await mkdtemp(
      join(tmpdir(), "clash-local-api-startup-config-"),
    );
    const dataDir = join(clashHome, "local-api");
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(clashHome, "config.yaml"),
      "version: 1\nharnesses:\n  enabled:\n    - codex-acp\n",
    );
    let releaseWarmup!: () => void;
    const warmupGate = new Promise<void>((resolve) => {
      releaseWarmup = resolve;
    });
    const reconcileConfiguration = vi.fn(async () => undefined);
    const localAcp = {
      updateSpawnEnv() {},
      warmup: vi.fn(async () => warmupGate),
      reconcileConfiguration,
      async listRuntimes() {
        return { runtimes: [] };
      },
      async createSession() {
        return { session_id: "unused" };
      },
      async listResumeSessions() {
        return { sessions: [] };
      },
      async disposeAll() {},
    };
    let server: Awaited<ReturnType<typeof startLocalApiServer>> | null = null;
    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        discovery: { enabled: false },
        localAcp: localAcp as never,
      });
      await writeFile(
        join(clashHome, "config.yaml"),
        "version: 1\nharnesses:\n  enabled:\n    - codex-acp\n    - claude-acp\n",
      );
      await new Promise((resolve) => setTimeout(resolve, 180));
      releaseWarmup();

      await vi.waitFor(
        () => expect(reconcileConfiguration).toHaveBeenCalledOnce(),
        { timeout: 1_000 },
      );
    } catch (error) {
      if (errorCode(error) === "EPERM") return;
      throw error;
    } finally {
      releaseWarmup();
      if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
      }
      await rm(clashHome, { recursive: true, force: true });
    }
  });

  it("creates a local Clash CLI shim and injects it into agent spawn env", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const env = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        CLASH_PROFILE: "dev",
        PATH: "/usr/bin:/bin",
      },
    });

    expect(env.CLASH_API_URL).toBe("http://127.0.0.1:49397");
    expect(env.CLASH_PROFILE).toBe("dev");
    expect(env).not.toHaveProperty("CLASH_API_KEY");
    expect(env.PATH?.split(":")[0]).toBe(join(dataDir, "agent-bin"));

    const shim = join(dataDir, "agent-bin", "clash");
    await expect(stat(shim)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    const shimText = await readFile(shim, "utf8");
    expect(shimText).toContain("CLASH_API_URL");
    expect(shimText).toContain("CLASH_PROFILE='dev'");
    expect(shimText).not.toContain("CLASH_API_KEY");
    expect(shimText).toContain("command -v node");
    expect(shimText).toContain("ELECTRON_RUN_AS_NODE=1");
  });

  it("pins the published Clash CLI to the authoritative Clash home", async () => {
    const clashHome = await mkdtemp(join(tmpdir(), "canonical-clash-home-"));
    const dataDir = join(clashHome, "local-api");
    const env = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_HOME: "/tmp/stale-clash-home",
        CLASH_LOCAL_DATA_DIR: "/tmp/stale-clash-home/local-api",
      },
    });

    expect(env.CLASH_HOME).toBe(clashHome);
    expect(env.CLASH_LOCAL_DATA_DIR).toBe(dataDir);

    const shimText = await readFile(
      join(dataDir, "agent-bin", "clash"),
      "utf8",
    );
    expect(shimText).toContain(`export CLASH_HOME='${clashHome}'`);
    expect(shimText).toContain(`export CLASH_LOCAL_DATA_DIR='${dataDir}'`);
    expect(shimText).not.toContain("/tmp/stale-clash-home");
  });

  it("passes an explicit Node runtime through to the local Clash CLI shim", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const env = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_NODE_EXEC_PATH: "/custom/node",
      },
    });

    expect(env.CLASH_NODE_EXEC_PATH).toBe("/custom/node");

    const shim = join(dataDir, "agent-bin", "clash");
    const shimText = await readFile(shim, "utf8");
    expect(shimText).toContain('exec "$CLASH_NODE_EXEC_PATH"');
  });

  it("uses an explicit Clash CLI entry path for child-process-safe packaged apps", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const childEnv = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_NODE_EXEC_PATH: "/custom/node",
        CLASH_CLI_ENTRY_PATH:
          "/Applications/Clash.app/Contents/Resources/clash-cli/dist/index.js",
        CLASH_CLI_NODE_PATH:
          "/Applications/Clash.app/Contents/Resources/clash-cli/vendor",
      },
    });

    const shim = join(dataDir, "agent-bin", "clash");
    const shimText = await readFile(shim, "utf8");
    expect(shimText).toContain(
      "/Applications/Clash.app/Contents/Resources/clash-cli/dist/index.js",
    );
    expect(shimText).toContain(
      "export CLASH_CLI_NODE_PATH='/Applications/Clash.app/Contents/Resources/clash-cli/vendor'",
    );
    expect(childEnv.CLASH_CLI_NODE_PATH).toBe(
      "/Applications/Clash.app/Contents/Resources/clash-cli/vendor",
    );
    expect(shimText).not.toContain("app.asar/node_modules/@clash/cli");
  });

  it("preserves the CLI source tsconfig when the development shim runs from a clean shell", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const tsconfigPath = "/workspace/packages/cli/tsconfig.dev.json";
    const childEnv = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_CLI_ENTRY_PATH: "/workspace/packages/cli/src/index.ts",
        TSX_TSCONFIG_PATH: tsconfigPath,
      },
    });

    const shimText = await readFile(
      join(dataDir, "agent-bin", "clash"),
      "utf8",
    );
    expect(shimText).toContain(`export TSX_TSCONFIG_PATH='${tsconfigPath}'`);
    expect(childEnv.TSX_TSCONFIG_PATH).toBe(tsconfigPath);
  });

  it("keeps the packaged CLI vendor path when the shim runs from a clean shell", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const cliEntry = join(dataDir, "print-node-path.cjs");
    const vendorPath = join(dataDir, "packaged-vendor");
    await writeFile(
      cliEntry,
      'process.stdout.write(process.env.NODE_PATH ?? "");\n',
      "utf8",
    );

    createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: process.env.PATH,
        CLASH_CLI_ENTRY_PATH: cliEntry,
        CLASH_CLI_NODE_PATH: vendorPath,
      },
    });

    const shim = join(dataDir, "agent-bin", "clash");
    const { stdout } = await execFileAsync(shim, [], {
      env: { PATH: process.env.PATH },
    });
    expect(stdout).toBe(vendorPath);
  });

  it("can expose a deterministic mock ACP agent for desktop smoke tests", async () => {
    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_E2E_STUB_ACP: "1",
    });

    await expect(adapter.listRuntimes()).resolves.toMatchObject({
      runtimes: [
        {
          id: "desktop-local",
          agents: [{ id: "mock-acp", binary: "mock-acp" }],
          status: "online",
        },
      ],
    });

    const created = await adapter.createSession({
      runtimeId: "desktop-local",
      agentTemplateId: "clash",
      agentMemberId: "mock-agent",
      projectId: "mock-project",
    });
    const handlers = new Map<string, (raw?: unknown) => void>();
    const sent: unknown[] = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((raw: string) => sent.push(JSON.parse(raw) as unknown)),
      on: vi.fn((event: string, handler: (raw?: unknown) => void) => {
        handlers.set(event, handler);
      }),
      close: vi.fn(),
    };

    adapter.bindSessionSocket(created.session_id, ws as never);
    handlers.get("message")?.(
      JSON.stringify({
        type: "prompt",
        turn_id: "turn-smoke",
        text: "hello local agent",
      }),
    );

    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        type: "session.complete",
        session_id: created.session_id,
        turn_id: "turn-smoke",
      });
    });
    const patchEvent = sent.find((message) => {
      const record = message as {
        type?: string;
        session_id?: string;
        turn_id?: string;
        event?: { sessionUpdate?: string; operations?: unknown[] };
      };
      return (
        record.type === "session.event" &&
        record.session_id === created.session_id &&
        record.turn_id === "turn-smoke" &&
        record.event?.sessionUpdate === "clash.canvas.patch" &&
        Array.isArray(record.event.operations)
      );
    }) as
      | {
          event: { operations: unknown[] };
        }
      | undefined;
    expect(patchEvent).toBeTruthy();
    expect(patchEvent?.event.operations).toEqual(
      expect.arrayContaining([
        {
          op: "add_node",
          node: {
            id: "mock-agent-stage-turn-smoke",
            type: "group",
            data: { label: "Agent Stage" },
            position: { x: 480, y: 140 },
            width: 620,
            height: 360,
            style: { width: 620, height: 360 },
          },
        },
        {
          op: "add_node",
          node: {
            id: "mock-agent-brief-turn-smoke",
            type: "action-badge",
            data: {
              label: "Agent Brief",
              actionType: "text-gen",
              content: "# Agent Brief\nhello local agent",
            },
            position: { x: 530, y: 210 },
            width: 260,
            height: 48,
          },
        },
        {
          op: "add_node",
          node: {
            id: "mock-agent-action-turn-smoke",
            type: "action-badge",
            data: {
              label: "Agent Image Pass",
              actionType: "image-gen",
              content: "# Prompt\nhello local agent",
            },
            position: { x: 530, y: 320 },
            width: 260,
            height: 48,
          },
        },
        {
          op: "timeline_apply",
          timeline: expect.objectContaining({
            nodeId: "mock-agent-timeline-turn-smoke",
          }),
        },
      ]),
    );

    const persisted = await adapter.listSessionMessages(created.session_id);
    expect(persisted).not.toBeNull();
    if (!persisted)
      throw new Error("expected persisted local session messages");
    expect(persisted.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "turn-smoke-user",
          sender_kind: "user",
          sender_id: "local-user",
          turn_id: "turn-smoke",
          events: [{ type: "text", text: "hello local agent" }],
        }),
        expect.objectContaining({
          id: "turn-smoke-agent",
          sender_kind: "agent",
          sender_id: "mock-agent",
          turn_id: "turn-smoke",
        }),
      ]),
    );
    const agentMessage = persisted.messages.find(
      (message) => message.id === "turn-smoke-agent",
    );
    expect(agentMessage?.events).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Mock ACP reply: hello local agent" },
        expect.objectContaining({ sessionUpdate: "clash.canvas.patch" }),
      ]),
    );
  });

  it("can stage a managed harness update and session restart for GUI E2E", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-harness-update-e2e-"));
    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_E2E_STUB_ACP: "1",
      CLASH_E2E_STUB_HARNESS_UPDATE: "1",
      CLASH_LOCAL_DATA_DIR: dataDir,
    });

    await expect(adapter.listHarnesses()).resolves.not.toMatchObject({
      harnesses: [expect.objectContaining({ updateAvailable: true })],
    });
    await writeFile(join(dataDir, ".e2e-harness-update-ready"), "ready\n");
    const staged = await adapter.listHarnesses();
    expect(
      staged.harnesses.find((harness) => harness.id === "mock-acp"),
    ).toMatchObject({
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
      updateAvailable: true,
    });

    const created = await adapter.createSession({
      runtimeId: "desktop-local",
      agentTemplateId: "clash",
      projectId: "mock-project",
    });
    await adapter.upgradeHarness("mock-acp");
    await expect(
      adapter.getSessionRuntimeStatus(created.session_id),
    ).resolves.toMatchObject({
      running_version: "1.0.0",
      installed_version: "2.0.0",
      restart_required: true,
    });
    await adapter.restartSession(created.session_id, { mode: "now" });
    await expect(
      adapter.getSessionRuntimeStatus(created.session_id),
    ).resolves.toMatchObject({
      running_version: "2.0.0",
      installed_version: "2.0.0",
      restart_required: false,
    });
  });

  it("can run a one-shot local ACP text task", async () => {
    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_E2E_STUB_ACP: "1",
    });

    await expect(
      adapter.runTextTask?.({
        projectId: "mock-project",
        prompt: "write a short caption",
        timeoutMs: 2_000,
      }),
    ).resolves.toMatchObject({
      text: expect.stringContaining("Mock ACP reply:"),
      sessionId: expect.any(String),
    });
  });

  it("does not expose the mock ACP agent from the legacy flag alone", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-real-path-"));
    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_LOCAL_ACP_MOCK: "1",
      CLASH_LOCAL_DATA_DIR: dataDir,
      CLASH_ACP_BIN_DIR: dataDir,
      PATH: "",
    });

    const runtimes = await adapter.listRuntimes();

    expect(
      runtimes.runtimes[0]?.agents.some((agent) => agent.id === "mock-acp"),
    ).toBe(false);
  });

  it("uses only the self-hosted ACP directory when a packaged runtime directory is also present", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-data-"));
    const packagedBinDir = await mkdtemp(
      join(tmpdir(), "clash-local-api-packaged-acp-bin-"),
    );
    const managedBinDir = join(dataDir, "acp-bin");
    await mkdir(managedBinDir, { recursive: true });
    const packagedCodexShim = join(packagedBinDir, "codex-acp");
    const codexShim = join(managedBinDir, "codex-acp");
    await writeFile(packagedCodexShim, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(packagedCodexShim, 0o755);
    await writeFile(codexShim, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(codexShim, 0o755);

    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_LOCAL_DATA_DIR: dataDir,
      CLASH_ACP_BIN_DIR: packagedBinDir,
      PATH: "",
    });

    await expect(adapter.listRuntimes()).resolves.toMatchObject({
      runtimes: [
        {
          agents: expect.arrayContaining([
            expect.objectContaining({
              id: "codex-acp",
              binary: codexShim,
            }),
          ]),
        },
      ],
    });
  });
});
