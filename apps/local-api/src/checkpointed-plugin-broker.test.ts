import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
  createProjectAsset,
  markActionAssetBindingAuthority,
  markProjectAssetAuthority,
  trashProjectAssetIfUnreferenced,
  type ExecutablePluginReference,
} from "@clash/shared-types";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { createLocalResourceStore } from "./local-resource-store.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";
import { createLocalPluginBrokerServices } from "./server.js";
import { LocalLoroRoomHub } from "./sync.js";

const manifest = ExecutablePluginManifestSchema.parse({
  apiVersion: "clash.plugin/v1",
  id: "test.checkpoint-reader",
  version: "1.0.0",
  name: "Checkpoint reader",
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
    generators: [],
    functions: [
      {
        id: "read",
        kind: "action",
        operations: ["submit"],
        assetInputs: [
          {
            match: { kinds: ["image"] },
            representations: ["bytes"],
          },
        ],
      },
    ],
    hostTools: [],
  },
});

describe("checkpointed plugin broker reads", () => {
  it("is readable while startup work owns the Project room operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-startup-checkpoint-"));
    const projectId = "project-startup-checkpoint";
    const seed = new LoroDoc();
    seed.getMap("startup").set("asset", "ready");
    await new FileReplicaStore(join(root, "projects")).saveSnapshotAtomic(
      projectId,
      seed.export({ mode: "snapshot" }),
    );

    let hub!: LocalLoroRoomHub;
    hub = new LocalLoroRoomHub(root, undefined, {
      async process({ doc, checkpoint }) {
        const startup = doc.getMap("startup");
        if (startup.get("processed") === true) return false;
        startup.set("checkpointed", true);
        if (!checkpoint) throw new Error("Room checkpoint is unavailable");
        await checkpoint();
        const observed = await hub.inspectCheckpointedProject(
          projectId,
          (checkpointed) => checkpointed.getMap("startup").toJSON(),
        );
        expect(observed).toEqual({ asset: "ready", checkpointed: true });
        startup.set("processed", true);
        return true;
      },
    });

    let opened = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        hub.room(projectId).then(() => "opened"),
        new Promise<string>(
          (_resolve, reject) =>
            (deadline = setTimeout(
              () => reject(new Error("startup checkpoint read timed out")),
              250,
            )),
        ),
      ]);
      opened = result === "opened";
      expect(result).toBe("opened");
    } finally {
      clearTimeout(deadline);
      if (opened) await hub.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves frozen Assets on the first invocation while the Project room operation is still active", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-checkpoint-broker-"));
    const roomDataDir = join(root, "room-local-api");
    const brokerDataDir = join(root, "broker-local-api");
    const projectId = "project-checkpointed-broker";
    const assetIds = [
      "director-capture:opening",
      "director-capture:middle",
      "director-capture:ending",
    ];
    const bytes = Uint8Array.from([1, 2, 3]);
    const installed = await createLocalResourceStore({
      dataDir: brokerDataDir,
    }).install({
      kind: "image",
      bytes,
      contentType: "image/png",
      originalName: "capture.png",
    });
    const hub = new LocalLoroRoomHub(roomDataDir);
    const broker = createLocalPluginBrokerServices({
      dataDir: brokerDataDir,
      inspectProjectDocument: (id, read) =>
        hub.inspectCheckpointedProject(id, read),
    });

    try {
      await hub.mutateProjectWithCheckpoint(
        projectId,
        async (doc, checkpoint) => {
          expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
          expect(markActionAssetBindingAuthority(doc)).toMatchObject({
            ok: true,
          });
          for (const assetId of assetIds) {
            expect(
              createProjectAsset(doc, {
                id: assetId,
                kind: "image",
                source: {
                  kind: "owned",
                  resourceId: installed.resource.id,
                },
                lifecycle: { state: "active" },
                metadata: {
                  width: 1,
                  height: 1,
                  bytes: bytes.byteLength,
                  contentType: "image/png",
                },
                provenance: {
                  kind: "render",
                  actionRunId: "director-capture:stage-revision-1",
                },
              }),
            ).toMatchObject({ ok: true });
          }
          await checkpoint();

          // A broker read must observe the acknowledged checkpoint, not later in-memory work.
          expect(
            trashProjectAssetIfUnreferenced(doc, {
              id: assetIds[0]!,
              deleteOperationId: "delete-after-checkpoint",
              deletedAt: "2026-08-15T00:00:00.000Z",
              purgeAfter: "2026-08-16T00:00:00.000Z",
            }),
          ).toMatchObject({ ok: true });

          const references: ExecutablePluginReference[] = assetIds.map(
            (assetId, index) => ({
              slot: `timeline:item:${index}`,
              index: 0,
              asset: {
                assetId,
                uri: `clash-asset://${assetId}`,
                kind: "image",
                mediaType: "image/png",
              },
            }),
          );
          const invocation = ExecutablePluginInvocationSchema.parse({
            protocol: "clash.plugin.invoke/v1",
            invocationId: "checkpointed-render-invocation",
            taskId: "timeline-render:first-attempt",
            projectId,
            target: {
              pluginId: manifest.id,
              version: manifest.version,
              exportId: "read",
              schemaHash: `sha256:${"a".repeat(64)}`,
              kind: "action",
            },
            input: { values: {}, references },
            assetInputs: [
              {
                match: { kinds: ["image"] },
                representations: ["bytes"],
              },
            ],
            actor: { kind: "agent", id: "agent-1" },
            operation: "submit",
          });

          for (const [index, reference] of references.entries()) {
            await expect(
              broker(
                {
                  protocol: "clash.plugin.broker-request/v1",
                  requestId: `resolve-${index}`,
                  invocationId: invocation.invocationId,
                  operation: { kind: "asset.resolve", reference },
                },
                { manifest, invocation },
              ),
            ).resolves.toMatchObject({
              form: "bytes",
              kind: "image",
              mediaType: "image/png",
              bytesBase64: "AQID",
            });
          }
        },
      );
    } finally {
      await broker.close?.();
      await hub.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
