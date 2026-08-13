import { describe, expect, it, vi } from "vitest";

import { createProjectAssetHttpClient } from "./project-asset-http-client.js";

const readyAsset = {
  id: "asset:one",
  kind: "image" as const,
  name: "frame.png",
  metadata: { bytes: 4, contentType: "image/png" },
  provenance: { kind: "import" as const },
  lifecycle: { state: "active" as const },
  status: "ready" as const,
  url: "https://media.clash.test/api/v1/projects/project%2Fone/assets/asset%3Aone/media",
};

describe("Project Asset HTTP client", () => {
  it("owns Project URL, auth, receipt, and ResolvedAsset validation for every consumer", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createProjectAssetHttpClient({
      resolveConnection: async () => ({ endpoint: "", token: "host-token" }),
      fetch: async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/batch")) {
          return new Response(JSON.stringify({ assets: [readyAsset] }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(readyAsset), {
          headers: {
            "content-type": "application/json",
            "x-clash-read-receipt": "receipt-one",
          },
        });
      },
    });

    await expect(
      client.get({ projectId: "project/one", assetId: "asset:one" }),
    ).resolves.toEqual({ value: readyAsset, receipt: "receipt-one" });
    await expect(
      client.batch({ projectId: "project/one", assetIds: ["asset:one"] }),
    ).resolves.toEqual([readyAsset]);

    expect(requests.map(({ url }) => url)).toEqual([
      "/api/v1/projects/project%2Fone/assets/asset%3Aone",
      "/api/v1/projects/project%2Fone/assets/batch",
    ]);
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer host-token",
    );
    expect(requests[1]?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ ids: ["asset:one"] }),
    });
  });

  it("imports the browser File through the one multipart route and preserves the caller id", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(readyAsset), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createProjectAssetHttpClient({ fetch });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "frame.png", {
      type: "image/png",
    });

    await expect(
      client.importFile({
        projectId: "project/one",
        file,
        kind: "image",
        projectAssetId: "asset:one",
      }),
    ).resolves.toEqual(readyAsset);

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      "/api/v1/projects/project%2Fone/assets/import-file",
    );
    const form = init?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("kind")).toBe("image");
    expect(form.get("projectAssetId")).toBe("asset:one");
  });

  it("admits one Global Asset through the Project client", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(readyAsset), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createProjectAssetHttpClient({ fetch });

    await expect(
      client.admit({
        projectId: "project/one",
        globalAssetId: "global:one",
      }),
    ).resolves.toEqual(readyAsset);

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/projects/project%2Fone/assets/admit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ globalAssetId: "global:one" }),
      }),
    );
  });

  it("rejects storage-shaped responses instead of widening the product Asset shape", async () => {
    const client = createProjectAssetHttpClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            ...readyAsset,
            storageKey: "private/frame.png",
          }),
          {
            headers: {
              "content-type": "application/json",
              "x-clash-read-receipt": "receipt-invalid",
            },
          },
        ),
    });

    await expect(
      client.get({ projectId: "project/one", assetId: "asset:one" }),
    ).rejects.toThrow(/unrecognized key.*storageKey/i);
  });
});
