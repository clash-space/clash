import { describe, expect, it, vi } from "vitest";

import {
  PROJECT_ASSET_READ_RECEIPT_HEADER,
  createProjectAssetHostClient,
} from "./project-asset-client.js";
import * as projectAssetClients from "./project-asset-client.js";
import { createProjectHostClient } from "./project-host-client.js";

const readyAsset = {
  id: "asset:one",
  kind: "image" as const,
  lifecycle: { state: "active" as const },
  name: "frame.png",
  metadata: { bytes: 4, contentType: "image/png" },
  provenance: { kind: "import" as const },
  status: "ready" as const,
  url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets/asset%3Aone/media",
};

describe("Project Asset Host client", () => {
  it("shares the exact discovered Host connection used by the MCP command client", async () => {
    const requests: string[] = [];
    let connections = 0;
    const hostClient = createProjectHostClient({
      env: { CLASH_PROJECT_ID: "project-a" },
      resolveConnection: async () => {
        connections += 1;
        return { endpoint: "http://127.0.0.1:49321", token: "host-token" };
      },
    });
    const client = createProjectAssetHostClient({
      env: { CLASH_API_URL: "http://wrong-host.invalid" },
      hostClient,
      fetch: async (input, init) => {
        requests.push(String(input));
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer host-token",
        );
        return new Response(JSON.stringify(readyAsset), {
          headers: {
            "content-type": "application/json",
            [PROJECT_ASSET_READ_RECEIPT_HEADER]: "receipt-shared-host",
          },
        });
      },
    });

    await expect(client.get({ assetId: "asset:one" })).resolves.toMatchObject({
      projectId: "project-a",
      receipt: "receipt-shared-host",
    });
    expect(connections).toBe(1);
    expect(requests).toEqual([
      "http://127.0.0.1:49321/api/v1/projects/project-a/assets/asset%3Aone",
    ]);
  });

  it("uses only Project-scoped ResolvedAsset routes and keeps Host receipts out of values", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "DELETE") {
          return new Response(
            JSON.stringify({
              ...readyAsset,
              lifecycle: {
                state: "trashed",
                deleteOperationId: "delete:test",
                deletedAt: "2026-08-13T00:00:00.000Z",
                purgeAfter: "2026-09-12T00:00:00.000Z",
              },
              status: "unavailable",
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                [PROJECT_ASSET_READ_RECEIPT_HEADER]: "receipt-after-trash",
              },
            },
          );
        }
        return new Response(JSON.stringify(readyAsset), {
          status: 200,
          headers: {
            "content-type": "application/json",
            [PROJECT_ASSET_READ_RECEIPT_HEADER]: "receipt-before-trash",
          },
        });
      },
    );
    const client = createProjectAssetHostClient({
      endpoint: "http://127.0.0.1:8789/",
      env: {},
      fetch,
    });

    const read = await client.get({
      projectId: "project-a",
      assetId: "asset:one",
    });
    expect(read).toEqual({
      projectId: "project-a",
      value: readyAsset,
      receipt: "receipt-before-trash",
    });
    const trashed = await client.trash({
      projectId: "project-a",
      assetId: "asset:one",
      actorClientType: "mcp",
      receipt: read.receipt,
    });
    expect(trashed).toEqual({
      projectId: "project-a",
      value: {
        ...readyAsset,
        lifecycle: {
          state: "trashed",
          deleteOperationId: "delete:test",
          deletedAt: "2026-08-13T00:00:00.000Z",
          purgeAfter: "2026-09-12T00:00:00.000Z",
        },
        status: "unavailable",
      },
      receipt: "receipt-after-trash",
    });
    expect(JSON.stringify(trashed.value)).not.toMatch(
      /receipt|readToken|ifMatch/i,
    );
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets/asset%3Aone",
        init: { method: "GET", headers: {} },
      },
      {
        url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets/asset%3Aone",
        init: {
          method: "DELETE",
          headers: {
            "x-clash-client-type": "mcp",
            "x-clash-if-match": "receipt-before-trash",
          },
        },
      },
    ]);
  });

  it("uploads workspace bytes through the single multipart import-file route", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createProjectAssetHostClient({
      endpoint: "http://127.0.0.1:8789",
      env: {},
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify(readyAsset), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(
      client.importFile({
        projectId: "project-a",
        bytes: new Uint8Array([1, 2, 3, 4]),
        fileName: "frame.png",
        contentType: "image/png",
        kind: "image",
      }),
    ).resolves.toEqual({ projectId: "project-a", value: readyAsset });
    expect(requests[0]?.url).toBe(
      "http://127.0.0.1:8789/api/v1/projects/project-a/assets/import-file",
    );
    expect(requests[0]?.init?.method).toBe("POST");
    const form = requests[0]?.init?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("kind")).toBe("image");
    const file = (form as FormData).get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("frame.png");
    expect(
      Array.from(new Uint8Array(await (file as File).arrayBuffer())),
    ).toEqual([1, 2, 3, 4]);
  });

  it("admits one Global Asset through the discovered Project Host", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createProjectAssetHostClient({
      endpoint: "http://127.0.0.1:8789",
      env: {},
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify(readyAsset), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    }) as ReturnType<typeof createProjectAssetHostClient> & {
      admit(input: {
        projectId: string;
        globalAssetId: string;
      }): Promise<{ projectId: string; value: typeof readyAsset }>;
    };

    await expect(
      client.admit({
        projectId: "project-a",
        globalAssetId: "global:one",
      }),
    ).resolves.toEqual({ projectId: "project-a", value: readyAsset });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets/admit",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ globalAssetId: "global:one" }),
        },
      },
    ]);
  });

  it("uses the discovered Host for personal Global Asset list and read", async () => {
    const globalAsset = {
      ...readyAsset,
      id: "global:one",
      url: "http://127.0.0.1:49321/api/v1/libraries/personal/assets/global%3Aone/media",
    };
    const requests: string[] = [];
    const createGlobalClient = (projectAssetClients as Record<string, unknown>)
      .createPersonalGlobalAssetHostClient as
      | undefined
      | ((options: Record<string, unknown>) => {
          list(): Promise<(typeof globalAsset)[]>;
          get(input: { globalAssetId: string }): Promise<typeof globalAsset>;
        });

    expect(createGlobalClient).toBeTypeOf("function");
    if (!createGlobalClient) return;
    const client = createGlobalClient({
      resolveConnection: async () => ({
        endpoint: "http://127.0.0.1:49321",
        token: "host-token",
      }),
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(String(input));
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer host-token",
        );
        return String(input).endsWith("/assets")
          ? new Response(JSON.stringify({ assets: [globalAsset] }))
          : new Response(JSON.stringify(globalAsset));
      },
    });

    await expect(client.list()).resolves.toEqual([globalAsset]);
    await expect(client.get({ globalAssetId: "global:one" })).resolves.toEqual(
      globalAsset,
    );
    expect(requests).toEqual([
      "http://127.0.0.1:49321/api/v1/libraries/personal/assets",
      "http://127.0.0.1:49321/api/v1/libraries/personal/assets/global%3Aone",
    ]);
  });

  it("uses one personal Global Asset client for import and Project publication", async () => {
    const globalAsset = {
      ...readyAsset,
      id: "global:one",
      url: "http://127.0.0.1:8789/api/v1/libraries/personal/assets/global%3Aone/media",
    };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const createGlobalClient = (projectAssetClients as Record<string, unknown>)
      .createPersonalGlobalAssetHostClient as
      | undefined
      | ((options: Record<string, unknown>) => {
          importFile(input: {
            bytes: Uint8Array;
            fileName: string;
            contentType: string;
            kind: "image";
          }): Promise<typeof globalAsset>;
          publish(input: {
            projectId: string;
            projectAssetId: string;
          }): Promise<typeof globalAsset>;
        });

    expect(createGlobalClient).toBeTypeOf("function");
    if (!createGlobalClient) return;
    const client = createGlobalClient({
      endpoint: "http://127.0.0.1:8789",
      env: {},
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify(globalAsset), { status: 201 });
      },
    });

    await expect(
      client.importFile({
        bytes: new Uint8Array([1, 2, 3, 4]),
        fileName: "frame.png",
        contentType: "image/png",
        kind: "image",
      }),
    ).resolves.toEqual(globalAsset);
    await expect(
      client.publish({
        projectId: "project-a",
        projectAssetId: "asset:one",
      }),
    ).resolves.toEqual(globalAsset);

    expect(
      requests.map(({ url, init }) => ({ url, method: init?.method })),
    ).toEqual([
      {
        url: "http://127.0.0.1:8789/api/v1/libraries/personal/assets/import-file",
        method: "POST",
      },
      {
        url: "http://127.0.0.1:8789/api/v1/libraries/personal/assets/publish",
        method: "POST",
      },
    ]);
    const importForm = requests[0]?.init?.body;
    expect(importForm).toBeInstanceOf(FormData);
    expect((importForm as FormData).get("kind")).toBe("image");
    const file = (importForm as FormData).get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("frame.png");
    expect(
      Array.from(new Uint8Array(await (file as File).arrayBuffer())),
    ).toEqual([1, 2, 3, 4]);
    expect(requests[1]?.init?.body).toBe(
      JSON.stringify({ projectId: "project-a", projectAssetId: "asset:one" }),
    );
  });

  it("lists and reads references, then restores through the same Project scope", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createProjectAssetHostClient({
      endpoint: "http://127.0.0.1:8789",
      env: {},
      fetch: async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/references")) {
          return new Response(
            JSON.stringify({
              projectAssetId: "asset:one",
              references: [],
            }),
            {
              headers: {
                "content-type": "application/json",
                [PROJECT_ASSET_READ_RECEIPT_HEADER]: "receipt-references",
              },
            },
          );
        }
        if (url.endsWith("/restore")) {
          return new Response(JSON.stringify(readyAsset), {
            headers: {
              "content-type": "application/json",
              [PROJECT_ASSET_READ_RECEIPT_HEADER]: "receipt-restored",
            },
          });
        }
        return new Response(JSON.stringify({ assets: [readyAsset] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(client.list({ projectId: "project-a" })).resolves.toEqual({
      projectId: "project-a",
      value: [readyAsset],
    });
    const references = await client.references({
      projectId: "project-a",
      assetId: "asset:one",
    });
    expect(references).toEqual({
      projectId: "project-a",
      value: [],
      receipt: "receipt-references",
    });
    await expect(
      client.restore({
        projectId: "project-a",
        assetId: "asset:one",
        actorClientType: "mcp",
        receipt: references.receipt,
      }),
    ).resolves.toEqual({
      projectId: "project-a",
      value: readyAsset,
      receipt: "receipt-restored",
    });
    expect(
      requests.map(({ url, init }) => ({
        url,
        method: init?.method,
        headers: init?.headers,
      })),
    ).toEqual([
      {
        url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets",
        method: "GET",
        headers: {},
      },
      {
        url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets/asset%3Aone/references",
        method: "GET",
        headers: {},
      },
      {
        url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets/asset%3Aone/restore",
        method: "POST",
        headers: {
          "x-clash-client-type": "mcp",
          "x-clash-if-match": "receipt-references",
        },
      },
    ]);
  });

  it("rejects a storage-shaped Host response instead of widening ResolvedAsset", async () => {
    const client = createProjectAssetHostClient({
      endpoint: "http://127.0.0.1:8789",
      env: {},
      fetch: async () =>
        new Response(
          JSON.stringify({
            ...readyAsset,
            storageKey: "blobs/private/original.png",
          }),
          {
            headers: {
              "content-type": "application/json",
              [PROJECT_ASSET_READ_RECEIPT_HEADER]: "receipt-invalid",
            },
          },
        ),
    });

    await expect(
      client.get({ projectId: "project-a", assetId: "asset:one" }),
    ).rejects.toThrow(/unrecognized key.*storageKey/i);
  });

  it("preserves the Host error code and message for CLI and MCP peers", async () => {
    const client = createProjectAssetHostClient({
      endpoint: "http://127.0.0.1:8789",
      env: {},
      fetch: async () =>
        new Response(
          JSON.stringify({
            code: "ASSET_IN_USE",
            error: "Project Asset has downstream Action inputs",
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
    });

    await expect(
      client.get({ projectId: "project-a", assetId: "asset:one" }),
    ).rejects.toThrow(
      /ASSET_IN_USE: Project Asset has downstream Action inputs.*HTTP 409/i,
    );
  });
});
