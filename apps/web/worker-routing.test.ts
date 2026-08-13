import { describe, expect, it } from "vitest";
import worker, { type Env } from "./workers/app";

function gatewayEnv(): Env {
  return {
    ASSETS: {
      fetch: async () => new Response("static boundary", { status: 404 }),
    },
    API_CF: {
      fetch: async () => new Response("api boundary", { status: 418 }),
    },
  } as unknown as Env;
}

describe("web worker Asset routing boundary", () => {
  it("does not carve anonymous upload out to api-cf", async () => {
    const response = await worker.fetch(
      new Request("https://clash.test/upload", { method: "POST" }),
      gatewayEnv(),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("static boundary");
  });

  it("keeps signed Asset delivery isolated as a transport route", async () => {
    const response = await worker.fetch(
      new Request("https://clash.test/assets/capability?exp=1&sig=opaque"),
      gatewayEnv(),
    );

    expect(response.status).toBe(418);
    expect(await response.text()).toBe("api boundary");
  });
});
