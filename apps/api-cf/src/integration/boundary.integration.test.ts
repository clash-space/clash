import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("api-cf integration boundary", () => {
  it("keeps the integration Worker reachable", async () => {
    const response = await SELF.fetch("https://api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("does not expose the legacy hosted Asset API", async () => {
    const response = await SELF.fetch("https://api/api/v1/assets/legacy-asset");

    expect(response.status).toBe(404);
  });
});
