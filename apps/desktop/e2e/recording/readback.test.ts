import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, it } from "node:test";

import { readProjectSnapshot } from "./readback.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

async function startHost(
  respond: (body: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ baseUrl: string; actions: string[] }> {
  const actions: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      actions.push(String(body.action));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(respond(body)));
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return { baseUrl: `http://127.0.0.1:${address.port}`, actions };
}

describe("demo product readback", () => {
  it("reads Canvas, edges, Timelines, renders, and Director Stages from the Host", async () => {
    const host = await startHost((body) => {
      switch (body.action) {
        case "list": return { nodes: [{ id: "node-1" }], versions: {} };
        case "edges": return { edges: [], version: "v1", readToken: "r1" };
        case "list_timelines": return { timelines: [{ id: "timeline-1" }], versions: {} };
        case "list_timeline_renders": return { renders: [{ id: "render-1" }] };
        case "list_director_stages": return { stages: [{ id: "stage-1" }], versions: {} };
        default: return { error: "unexpected" };
      }
    });

    const snapshot = await readProjectSnapshot({
      apiBaseUrl: host.baseUrl,
      projectId: "project/demo",
    });

    assert.deepEqual(host.actions, [
      "list",
      "edges",
      "list_timelines",
      "list_timeline_renders",
      "list_director_stages",
    ]);
    assert.deepEqual(snapshot.canvas, { nodes: [{ id: "node-1" }], versions: {} });
    assert.deepEqual(snapshot.timelines, { timelines: [{ id: "timeline-1" }], versions: {} });
    assert.deepEqual(snapshot.directorStages, { stages: [{ id: "stage-1" }], versions: {} });
  });

  it("rejects a semantic Host error returned with HTTP 200", async () => {
    const host = await startHost((body) =>
      body.action === "edges" ? { error: "Project replica unavailable" } : {},
    );

    await assert.rejects(
      readProjectSnapshot({ apiBaseUrl: host.baseUrl, projectId: "project-1" }),
      /edges.*Project replica unavailable/iu,
    );
  });

  it("times out when a Host read never settles", async () => {
    const neverFetch = async (): Promise<Response> =>
      await new Promise<Response>(() => {});
    const guardedRead = Promise.race([
      readProjectSnapshot({
        apiBaseUrl: "http://127.0.0.1:49153",
        projectId: "project-1",
        fetchFn: neverFetch as typeof fetch,
        timeoutMs: 10,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("test watchdog fired")), 250);
      }),
    ]);

    await assert.rejects(guardedRead, /snapshot read timed out/iu);
  });
});
