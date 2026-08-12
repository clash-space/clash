import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ActionsHost } from "./runtime/host/lib/actions-loader.js";

import { createProviderPluginExecutor } from "./provider-plugin-executor.js";
import { importLocalCredential } from "./local-credential-import.js";
import { fetchIntoSlot } from "./upload-slot-fetch.js";
import { createLocalExecutablePluginBroker } from "./local-plugin-broker.js";

/**
 * One real generation, through the host rather than around it.
 *
 * Everything below this comment ran by hand at some point today, and each hand-rolled step hid a
 * fault the real path would have surfaced: a stub `asset.upload-slot` answer produced "Cannot read
 * properties of undefined (reading 'byteLength')", which says nothing about the stub being wrong.
 * The polling loop is the host's, the broker is the host's, and the credential comes from the
 * Provider's own declared recipe.
 *
 * Marked with a long timeout and skipped unless CLASH_REAL_GENERATION is set: it spends the user's
 * quota and needs the local MiniMax Hub app to be signed in.
 */
const REAL = process.env.CLASH_REAL_GENERATION === "1";

describe.runIf(REAL)("hrhrng.hub", () => {
  it("generates an image end to end", async () => {
    const actionsRoot = join(process.env.HOME!, ".clash", "actions");

    // The credential comes from the declaration, not from this test. Nothing here knows what a
    // MiniMax token looks like or where the Hub app keeps it.
    const provider = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(actionsRoot, "hrhrng.hub/providers/hilo-hub.json"), "utf8")),
    ) as { spec: { auth: { methods: { id: string; import?: Record<string, unknown> }[] } } };

    const recipe = provider.spec.auth.methods.find((method) => method.import)?.import as
      never as Parameters<typeof importLocalCredential>[0] & { appDataSubdirectory: string };
    expect(recipe).toBeDefined();

    const credential = await importLocalCredential(
      recipe,
      join(process.env.HOME!, "Library/Application Support", recipe.appDataSubdirectory),
    );

    const assets = mkdtempSync(join(tmpdir(), "real-gen-"));
    const host = new ActionsHost({
      actionsRoot,
      serverUrl: "http://127.0.0.1:0",
      apiKey: "",
      runtimeId: "real-generation",
      executablePluginsOnly: true,
      pluginBroker: createLocalExecutablePluginBroker({
        loadProviderAccounts: async () => [],
        // The store the plugin reads through `context.store`, holding what the import produced.
        storeGet: async ({ key }: { key: string }) => credential[key],
        storePut: async () => {},
        // The upload path the SDK actually uses. A vendor that answers with a link never
        // uploads anything, so the host fetches it here -- which is the step where a completed,
        // paid-for generation was being dropped.
        openUploadSlot: async ({ slot, url, mediaType }: {
          slot: string; url?: string; mediaType?: string;
        }) => {
          if (!url) throw new Error(`Slot ${slot} arrived with neither bytes nor a url.`);
          const fetched = await fetchIntoSlot(url, { ...(mediaType ? { mediaType } : {}) });
          const name = `gen-${Date.now()}.${(fetched.mediaType ?? "image/png").split("/")[1]}`;
          writeFileSync(join(assets, name), fetched.bytes);
          console.log(`ARTEFACT: ${join(assets, name)} (${fetched.bytes.byteLength} bytes)`);
          return { assetId: name };
        },
        writeAsset: async ({ bytes, mediaType }: { bytes: Uint8Array; mediaType?: string }) => {
          const name = `gen-${Date.now()}.${(mediaType ?? "image/png").split("/")[1]}`;
          writeFileSync(join(assets, name), bytes);
          return {
            assetId: name,
            uri: `clash-asset://${name}`,
            kind: "image",
            mediaType,
            url: `http://127.0.0.1:8787/assets/${name}`,
            reach: "private",
          };
        },
      } as never),
    } as never);

    await host.start?.();
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const execute = createProviderPluginExecutor({
      client: {
        // All three, from the real host. `listFunctionExports` is how the executor learns that an
        // acceptance can be polled; a client that omits it turns a working async provider into
        // "accepted work but does not declare the poll operation".
        listFunctionExports: async (pluginId: string) => await host.listFunctionExports!(pluginId),
        resolveBinding: async (
          pluginId: string,
          exportId: string,
          kind: "action" | "provider-projector" | "provider-executor",
        ) =>
          await host.resolveBinding!(pluginId, exportId, kind),
        invoke: async (pluginId: string, invocation: unknown) => await host.invoke!(pluginId, invocation),
      } as never,
    });

    const request = {
      pluginId: "hrhrng.hub",
      exportId: "hilo-hub-execute",
      taskId: "real-task",
      projectId: "real-project",
      accountId: "hilo-hub-primary",
      input: {
        values: {
          model: "gpt-image-2",
          upstreamModel: "gpt-image-2",
          prompt: "a single red maple leaf on wet slate, overhead, soft daylight",
        },
        references: [],
      },
    };

    // The host's own polling contract: submit, then poll with whatever state came back, honouring
    // the retry delay the plugin asked for. Writing this loop by hand in a scratch script is what
    // produced a byteLength error from a fabricated upload slot.
    let result = await execute(request as never);
    for (let attempt = 0; attempt < 60 && result.status === "accepted"; attempt += 1) {
      const retryAfterMs = result.status === "accepted" ? result.retryAfterMs : undefined;
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, retryAfterMs ?? 5000)));
      result = await execute({ ...request, pollState: result.pollState } as never);
    }

    expect(result.status).toBe("completed");
    if (result.status !== "completed" || !("media" in result)) return;
    // What a completed generation hands back is an address the host can serve. The bytes came from
    // the vendor, this host fetched and stored them, and the media points at its own asset
    // endpoint -- not at a `clash-asset://` uri, which is the plugin-side handle and never left
    // the broker.
    expect(result.media?.url).toMatch(/^http:\/\/127\.0\.0\.1:8787\/api\/v1\/assets\//);
    console.log(`ARTEFACT: ${assets}`);
  }, 600_000);
});
