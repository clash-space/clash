import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { app } from "./app";
import { processPendingNodes } from "./processors/NodeProcessor";
import type { Env } from "./types";

function legacyEnv(seed: ReadonlyMap<string, Uint8Array> = new Map()): {
  env: Env;
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map(seed);
  return {
    objects,
    env: {
      ASSETS: {
        get: async (key: string) => {
          const bytes = objects.get(key);
          return bytes
            ? {
                body: new Response(bytes).body,
                httpMetadata: { contentType: "image/png" },
              }
            : null;
        },
        put: async (key: string, value: ArrayBuffer) => {
          objects.set(key, new Uint8Array(value));
        },
      },
    } as unknown as Env,
  };
}

describe("legacy loro-sync Asset boundary", () => {
  it("does not accept anonymous raw-key uploads", async () => {
    const { env, objects } = legacyEnv();
    const form = new FormData();
    form.append("file", new File(["bytes"], "source.png"));
    form.append("projectId", "project-1");

    const response = await app.request(
      "/upload",
      { method: "POST", body: form },
      env,
    );

    expect(response.status).toBe(404);
    expect(objects.size).toBe(0);
  });

  it("does not serve a bucket object by its raw storage key", async () => {
    const key = "projects/project-1/source.png";
    const { env } = legacyEnv(new Map([[key, new Uint8Array([1, 2, 3])]]));

    const response = await app.request(`/assets/${key}`, {}, env);

    expect(response.status).toBe(404);
  });
});

describe("legacy loro-sync execution boundary", () => {
  it("leaves raw pending nodes for the authoritative host without submitting Cloud work", async () => {
    const doc = new LoroDoc();
    doc.getMap("nodes").set("pending-image", {
      type: "image",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        prompt: "leave this with the authoritative host",
      },
    });

    const submittedRequests: Request[] = [];
    const env = {
      API_CF: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          submittedRequests.push(new Request(input, init));
          return Response.json({ task_id: "legacy-cloud-task" });
        },
      },
    } as unknown as Env;
    let pollingRequests = 0;

    await processPendingNodes(
      doc,
      env,
      "project-1",
      () => {},
      async () => {
        pollingRequests += 1;
      },
    );

    expect(submittedRequests).toEqual([]);
    expect(pollingRequests).toBe(0);
    expect(doc.getMap("nodes").get("pending-image")).toMatchObject({
      data: {
        status: "pending",
        prompt: "leave this with the authoritative host",
      },
    });
  });
});
