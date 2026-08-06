import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ActionsHost } from "@clash-space/bridge/actions-host";
import { PluginHostClient, startPluginHostIpcServer } from "@clash-space/bridge/plugin-host";
import { expect, it } from "vitest";

import { ensureBundledFirstPartyMediaPlugin } from "./bundled-plugins";
import { createMockExternalAigcService } from "./local-aigc";
import { createBridgeProviderPluginProjector } from "./provider-plugin-projector";

it("executes the fal H3 projection through the installed agent-editable stdio plugin", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-provider-plugin-runtime-"));
  process.env.CLASH_HOME = clashHome;
  const pluginSource = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../plugins/first-party-media",
  );
  await ensureBundledFirstPartyMediaPlugin({
    actionsRoot: join(clashHome, "actions"),
    manifestPath: join(pluginSource, "manifest.json"),
    entrypointPath: join(pluginSource, "dist", "stdio.mjs"),
  });
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "legacy-only",
    runtimeId: "runtime-local",
  });
  const socketPath = join(clashHome, "plugin-host.sock");
  let ipc: Awaited<ReturnType<typeof startPluginHostIpcServer>> | null = null;

  try {
    await host.start();
    ipc = await startPluginHostIpcServer({ host, socketPath });
    const pluginHostClient = new PluginHostClient({ socketPath });
    const discoveredCards = await pluginHostClient.listCards();
    expect(discoveredCards.map((registration) => registration.document.spec.id)).toEqual([
      "minimax-h3",
      "minimax-h3-startend",
      "minimax-music-3",
      "seedance-2-ref",
      "seedance-2-startend",
      "seedance-2.5-ref",
      "seedance-2.5-startend",
    ]);
    expect(discoveredCards.every((registration) =>
      registration.pluginId === "clash-first-party-media"
      && registration.version === "0.3.0"
      && /^sha256:/.test(registration.schemaHash)
    )).toBe(true);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        providerId: "fal",
        upstreamId: "fal",
        apiShape: "fal",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "fal-local-key" },
      }],
      providerPluginProjector: createBridgeProviderPluginProjector({
        client: pluginHostClient,
      }),
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://queue.fal.run/minimax/h3/reference-to-video") return Response.json({ request_id: "runtime-h3-1" });
        if (url.endsWith("/requests/runtime-h3-1/status")) return Response.json({ status: "COMPLETED" });
        if (url.endsWith("/requests/runtime-h3-1")) return Response.json({ video: { url: "https://fal-cdn.test/runtime-h3.mp4" } });
        if (url === "https://fal-cdn.test/runtime-h3.mp4") return new Response("runtime-video", { headers: { "content-type": "video/mp4" } });
        return new Response("not found", { status: 404 });
      },
    });

    const result = await service.generateVideo({
      taskId: "task-runtime-h3",
      projectId: "project-runtime-h3",
      nodeId: "node-runtime-h3",
      prompt: "Use Image 1",
      model: "minimax-h3",
      aspectRatio: "adaptive",
      duration: 8,
      referenceImageUrls: ["https://media.test/character.png"],
      modelParams: { resolution: "2K" },
    });

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      prompt: "Use Image 1",
      duration: 8,
      resolution: "2K",
      aspect_ratio: "adaptive",
      reference_image_urls: ["https://media.test/character.png"],
    });
    expect(result.pluginBinding).toMatchObject({
      pluginId: "clash-first-party-media",
      version: "0.3.0",
      exportId: "fal-h3",
      schemaHash: expect.stringMatching(/^sha256:/),
    });
  } finally {
    await ipc?.close();
    await host.stopAll();
    if (originalClashHome === undefined) delete process.env.CLASH_HOME;
    else process.env.CLASH_HOME = originalClashHome;
  }
});
