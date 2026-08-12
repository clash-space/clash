import { describe, expect, it, vi } from "vitest";

import { fetchIntoSlot } from "./upload-slot-fetch.js";

/**
 * When the vendor answers with a link, the host is the one that fetches it.
 *
 * The plugin passes the address through rather than downloading it: the host is the side that
 * knows whether it wants a copy at all -- a local host does, a hosted one behind the same object
 * storage may simply record the address. Making the plugin download it would pay for the transfer
 * twice and put the bytes through a stdio pipe on the way.
 *
 * hrhrng.hub is the first executor here whose vendor replies with a link, and everything upstream
 * of this already works: the credential imports itself, the task submits, the poll completes. The
 * result was being dropped at the last step.
 */
describe("fetchIntoSlot", () => {
  it("fetches the address and returns the bytes with the type the server reported", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    }));

    const result = await fetchIntoSlot("https://cdn.example.test/out.png", { fetchImpl } as never);

    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.mediaType).toBe("image/png");
  });

  it("keeps the declared media type over the server's when both are present", async () => {
    // Vendors serve generated media as application/octet-stream often enough that trusting the
    // header would store a video the player refuses to open.
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), {
      headers: { "content-type": "application/octet-stream" },
    }));

    const result = await fetchIntoSlot("https://cdn.example.test/out.mp4", {
      fetchImpl, mediaType: "video/mp4",
    } as never);

    expect(result.mediaType).toBe("video/mp4");
  });

  it("says the vendor's link failed rather than storing an error page", async () => {
    // A 403 body is bytes too. Storing it produces an asset that opens as text and a node that
    // looks finished.
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));

    await expect(fetchIntoSlot("https://cdn.example.test/out.png", { fetchImpl } as never))
      .rejects.toThrow(/403/);
  });

  it("refuses a plaintext address", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchIntoSlot("http://cdn.example.test/out.png", { fetchImpl } as never))
      .rejects.toThrow(/https/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an empty body instead of storing a zero-byte asset", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(), {
      headers: { "content-type": "image/png" },
    }));

    await expect(fetchIntoSlot("https://cdn.example.test/out.png", { fetchImpl } as never))
      .rejects.toThrow(/no bytes/i);
  });
});
