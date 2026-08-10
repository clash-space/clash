import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
} from "@clash/shared-types";

import { createLocalKernelPluginBroker } from "./local-kernel-plugin-broker";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Bridge local Kernel plugin broker transport", () => {
  it("forwards the exact broker envelope using only the rotated 0600 discovery bearer", async () => {
    root = await mkdtemp(join(tmpdir(), "clash-kernel-broker-"));
    const discoveryPath = join(root, "host.json");
    await writeFile(discoveryPath, JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      dataSchemaVersion: 1,
      hostId: "host-1",
      endpoint: "http://127.0.0.1:49321",
      pid: process.pid,
      launchMode: "desktop",
      startedBy: "desktop",
      pluginBrokerToken: "b".repeat(64),
      startedAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    }));
    // `RequestInfo` is a DOM name and this package compiles with lib ES2022 plus @types/node, where
    // fetch exists but the DOM aliases do not. `Parameters<typeof fetch>[0]` is the same type without
    // depending on which lib happens to be loaded.
    const fetchMock = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-clash-local-plugin-broker-token")).toBe("b".repeat(64));
      const envelope = JSON.parse(String(init?.body));
      return Response.json({
        protocol: "clash.plugin.broker-response/v1",
        requestId: envelope.request.requestId,
        status: "ok",
        result: { handle: "clash-secret://opaque" },
      });
    });
    const broker = createLocalKernelPluginBroker({
      discoveryPath,
      fetch: fetchMock as typeof fetch,
    });
    const manifest = ExecutablePluginManifestSchema.parse({
      apiVersion: "clash.plugin/v1",
      id: "acme.media",
      version: "1.2.3",
      name: "Acme Media",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: { cards: [], functions: [{ id: "render", kind: "action", handler: "render" }] },
      permissions: { secrets: ["provider:fal"] },
    });
    const invocation = ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "acme.media",
        version: "1.2.3",
        exportId: "render",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "action",
      },
      input: { values: {}, references: [] },
      actor: { kind: "user", id: "local-user" },
    });

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:fal" },
    }, { manifest, invocation })).resolves.toEqual({ handle: "clash-secret://opaque" });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:49321/api/v1/local/plugin-broker"),
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
  });
});
