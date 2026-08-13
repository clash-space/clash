import { describe, expect, it, vi } from "vitest";

import { createPersonalGlobalAssetHttpClient } from "./personal-global-asset-http-client.js";

const readyAsset = {
  id: "global:one",
  kind: "image" as const,
  name: "frame.png",
  metadata: { bytes: 4, contentType: "image/png" },
  provenance: { kind: "import" as const },
  lifecycle: { state: "active" as const },
  status: "ready" as const,
  url: "https://media.clash.test/api/v1/libraries/personal/assets/global%3Aone/media",
};

describe("Personal Global Asset HTTP client", () => {
  it("owns personal-library URLs, authorization, and canonical response validation", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith("/assets")
        ? Response.json({ assets: [readyAsset] })
        : Response.json(readyAsset);
    });
    const client = createPersonalGlobalAssetHttpClient({
      endpoint: "https://host.clash.test/",
      token: "host-token",
      fetch,
    });

    await expect(client.list()).resolves.toEqual([readyAsset]);
    await expect(client.get({ globalAssetId: "global:one" })).resolves.toEqual(
      readyAsset,
    );

    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "https://host.clash.test/api/v1/libraries/personal/assets",
      "https://host.clash.test/api/v1/libraries/personal/assets/global%3Aone",
    ]);
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer host-token");
  });

  it("owns import and Project-to-Global publish request shapes", async () => {
    const fetch = vi.fn(async () => Response.json(readyAsset, { status: 201 }));
    const client = createPersonalGlobalAssetHttpClient({ fetch });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "frame.png", {
      type: "image/png",
    });

    await client.importFile({ file, kind: "image" });
    await client.publish({
      projectId: "project/one",
      projectAssetId: "asset:one",
    });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "/api/v1/libraries/personal/assets/import-file",
    );
    const form = fetch.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("kind")).toBe("image");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        projectId: "project/one",
        projectAssetId: "asset:one",
      }),
    });
  });

  it("owns trash and restore routes", async () => {
    const fetch = vi.fn(async () => Response.json(readyAsset));
    const client = createPersonalGlobalAssetHttpClient({ fetch });

    await client.trash({ globalAssetId: "global:one" });
    await client.restore({ globalAssetId: "global:one" });

    expect(fetch.mock.calls).toEqual([
      [
        "/api/v1/libraries/personal/assets/global%3Aone",
        expect.objectContaining({ method: "DELETE" }),
      ],
      [
        "/api/v1/libraries/personal/assets/global%3Aone/restore",
        expect.objectContaining({ method: "POST" }),
      ],
    ]);
  });
});
