import { describe, expect, it } from "vitest";

import { falSubmit, falPoll, type FalPollState } from "./fal-executor";

/**
 * fal's queue, translated rather than waited on.
 *
 * The host used to do this inline: submit, then loop up to 240 times a second apart, then download.
 * That capped every fal generation at four minutes — a start/end-frame video measured on this
 * machine took 275 seconds, so the ceiling was already inside the range of ordinary work. It also
 * kept fal's request id in a local variable, so a host that stopped mid-loop lost a paid generation.
 *
 * Split in two, neither half waits. Submit hands back what fal needs to be asked again; poll answers
 * from one status check. How often to ask, and for how long, stops being fal's opinion.
 */
describe("fal executor", () => {
  const endpoint = "fal-ai/minimax/hailuo-h3";
  const apiKey = "test-key";

  function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: "OK",
      headers: new Map<string, string>(),
      json: async () => body,
    };
  }

  it("returns fal's request id as poll state instead of waiting for it", async () => {
    const fetch = async () => jsonResponse({ request_id: "req-1" });
    const result = await falSubmit({
      endpoint,
      apiKey,
      body: { prompt: "a cat" },
      fetch: fetch as never,
    });
    expect(result.pollState).toEqual({ requestId: "req-1", endpoint });
  });

  it("refuses a submission fal did not acknowledge", async () => {
    // Without an id there is nothing to poll, and reporting success would leave the host waiting on
    // work it can never ask about.
    const fetch = async () => jsonResponse({ detail: "no id here" });
    await expect(falSubmit({
      endpoint,
      apiKey,
      body: {},
      fetch: fetch as never,
    })).rejects.toThrow(/request_id/);
  });

  it("reports still-running work as unfinished, with the same state", async () => {
    const state: FalPollState = { requestId: "req-1", endpoint };
    const fetch = async () => jsonResponse({ status: "IN_PROGRESS" });
    const result = await falPoll({ state, apiKey, kind: "video", fetch: fetch as never });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("expected accepted");
    expect(result.pollState).toEqual(state);
  });

  it("surfaces a failed job as an error rather than an endless wait", async () => {
    const state: FalPollState = { requestId: "req-1", endpoint };
    const fetch = async () => jsonResponse({ status: "FAILED", error: "capacity" });
    await expect(falPoll({ state, apiKey, kind: "video", fetch: fetch as never }))
      .rejects.toThrow(/capacity|FAILED/);
  });

  it("returns the media url once fal reports completion", async () => {
    const state: FalPollState = { requestId: "req-1", endpoint };
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("/status")) return jsonResponse({ status: "COMPLETED" });
      return jsonResponse({ data: { video: { url: "https://fal.test/out.mp4" } } });
    };
    const result = await falPoll({ state, apiKey, kind: "video", fetch: fetch as never });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed");
    expect(result.media.url).toBe("https://fal.test/out.mp4");
    // One status check per poll. Looping here would put the wait back where it was.
    expect(calls.filter((url) => url.endsWith("/status"))).toHaveLength(1);
  });

  it("never sleeps", async () => {
    // The point of the split is that neither half decides how long to wait. A timer in here would
    // reintroduce a ceiling that no Model Card asked for.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./fal-executor.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/setTimeout|setInterval|sleep\(/);
    expect(source).not.toMatch(/for \(let attempt/);
  });
});
