import { describe, expect, it } from "vitest";

import { replicateSubmit, replicatePoll, type ReplicatePollState } from "./replicate-executor";

/**
 * Replicate's prediction API, translated rather than waited on.
 *
 * The host used to do this inline: create a prediction, then loop up to 240 times a second apart,
 * then download. Four minutes was not a considered number, and it sat beside six other loops with
 * six other ceilings, none of them derived from anything a model actually declares. The prediction
 * id also lived in a local variable, so a host that stopped mid-loop lost a generation Replicate
 * was already charging for.
 *
 * Split in two, neither half waits. Submit reports what Replicate called the job; poll answers from
 * a single read.
 */
describe("replicate executor", () => {
  const upstreamModel = "minimax/video-01";
  const apiKey = "test-key";
  const baseUrl = "https://api.replicate.test/v1";

  function jsonResponse(body: unknown, init: { ok?: boolean; statusText?: string } = {}) {
    return {
      ok: init.ok ?? true,
      status: init.ok === false ? 400 : 200,
      statusText: init.statusText ?? "OK",
      json: async () => body,
    };
  }

  it("carries Replicate's own poll URL, not just the prediction id", async () => {
    // Replicate hands back the address to read the prediction from. Rebuilding it from the id works
    // right up until a prediction is served from somewhere other than where we sent it -- a
    // regional host, or a redirect after a model move.
    //
    // The address here deliberately differs from the one the fallback would construct. An example
    // that matches the fallback byte for byte passes whether the supplied url is honoured or
    // discarded, which is a test that cannot fail for the reason it was written.
    const fetch = async () => jsonResponse({
      id: "pred-1",
      status: "starting",
      urls: { get: "https://eu-west.replicate.test/v1/predictions/pred-1" },
    });
    const result = await replicateSubmit({
      upstreamModel,
      apiKey,
      input: { prompt: "a cat" },
      fetch: fetch as never,
      baseUrl,
    });
    expect(result.pollState).toEqual({
      predictionId: "pred-1",
      getUrl: "https://eu-west.replicate.test/v1/predictions/pred-1",
    });
  });

  it("falls back to the conventional prediction address when Replicate omits one", async () => {
    const fetch = async () => jsonResponse({ id: "pred-2", status: "starting" });
    const result = await replicateSubmit({
      upstreamModel,
      apiKey,
      input: {},
      fetch: fetch as never,
      baseUrl,
    });
    expect(result.pollState.getUrl).toBe("https://api.replicate.test/v1/predictions/pred-2");
  });

  it("creates the prediction under the owner/name path Replicate requires", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetch = async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return jsonResponse({ id: "pred-3", status: "starting" });
    };
    await replicateSubmit({
      upstreamModel,
      apiKey,
      input: { prompt: "hi" },
      fetch: fetch as never,
      baseUrl,
    });
    expect(calls[0]?.url).toBe("https://api.replicate.test/v1/models/minimax/video-01/predictions");
    // Replicate nests the model's own parameters under `input`; sending them flat is silently
    // ignored rather than rejected, which produces a default generation nobody asked for.
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ input: { prompt: "hi" } });
  });

  it("refuses a model name that is not owner/name", async () => {
    const fetch = async () => jsonResponse({ id: "pred-4", status: "starting" });
    await expect(replicateSubmit({
      upstreamModel: "video-01",
      apiKey,
      input: {},
      fetch: fetch as never,
      baseUrl,
    })).rejects.toThrow(/owner\/name/);
  });

  it("refuses a creation Replicate did not acknowledge with an id", async () => {
    // Without an id there is nothing to read back. Reporting success would leave the host holding a
    // job it can never ask about, and Replicate may well have started it.
    const fetch = async () => jsonResponse({ status: "starting" });
    await expect(replicateSubmit({
      upstreamModel,
      apiKey,
      input: {},
      fetch: fetch as never,
      baseUrl,
    })).rejects.toThrow(/prediction id/);
  });

  it("surfaces a rejected creation with Replicate's own explanation", async () => {
    const fetch = async () => jsonResponse({ detail: "insufficient credit" }, { ok: false });
    await expect(replicateSubmit({
      upstreamModel,
      apiKey,
      input: {},
      fetch: fetch as never,
      baseUrl,
    })).rejects.toThrow(/insufficient credit/);
  });

  it("reports unfinished work as accepted, preserving the state to ask again", async () => {
    const state: ReplicatePollState = { predictionId: "pred-1", getUrl: `${baseUrl}/predictions/pred-1` };
    for (const status of ["starting", "processing"]) {
      const fetch = async () => jsonResponse({ id: "pred-1", status });
      const result = await replicatePoll({ state, apiKey, fetch: fetch as never });
      expect(result.status, status).toBe("accepted");
      if (result.status !== "accepted") throw new Error("expected accepted");
      expect(result.pollState).toEqual(state);
    }
  });

  it("treats a cancelled prediction as failed, not as still running", async () => {
    // A cancelled job never reaches succeeded, so anything that only watches for success waits out
    // the whole budget before reporting a timeout that hides the real reason.
    const state: ReplicatePollState = { predictionId: "pred-1", getUrl: `${baseUrl}/predictions/pred-1` };
    const fetch = async () => jsonResponse({ id: "pred-1", status: "canceled" });
    await expect(replicatePoll({ state, apiKey, fetch: fetch as never }))
      .rejects.toThrow(/failed|cancel/i);
  });

  it("surfaces a failed prediction with Replicate's error text", async () => {
    const state: ReplicatePollState = { predictionId: "pred-1", getUrl: `${baseUrl}/predictions/pred-1` };
    const fetch = async () => jsonResponse({ id: "pred-1", status: "failed", error: "NSFW content detected" });
    await expect(replicatePoll({ state, apiKey, fetch: fetch as never }))
      .rejects.toThrow(/NSFW content detected/);
  });

  it("returns the media url once the prediction succeeds", async () => {
    // Again a distinctly non-reconstructible address, so this also proves poll reads the state it
    // was given rather than an address of its own devising.
    const state: ReplicatePollState = {
      predictionId: "pred-1",
      getUrl: "https://eu-west.replicate.test/v1/predictions/pred-1",
    };
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      return jsonResponse({
        id: "pred-1",
        status: "succeeded",
        output: "https://replicate.test/out.mp4",
      });
    };
    const result = await replicatePoll({ state, apiKey, fetch: fetch as never });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed");
    expect(result.media.url).toBe("https://replicate.test/out.mp4");
    expect(result.requestId).toBe("pred-1");
    expect(calls).toEqual(["https://eu-west.replicate.test/v1/predictions/pred-1"]);
    // One read per poll. A loop here would put the wait back where it was.
    expect(calls).toHaveLength(1);
  });

  it("finds the media url wherever this model happens to put it", async () => {
    // Replicate's output shape is the model author's choice, not Replicate's: a bare string, an
    // array, or an object keyed by media type. All three arrive on the same endpoint.
    const state: ReplicatePollState = { predictionId: "pred-1", getUrl: `${baseUrl}/predictions/pred-1` };
    const outputs: Array<[string, unknown]> = [
      ["bare string", "https://replicate.test/a.png"],
      ["array", ["https://replicate.test/a.png", "https://replicate.test/b.png"]],
      ["keyed object", { video: "https://replicate.test/a.png" }],
      ["nested array", [{ url: "https://replicate.test/a.png" }]],
    ];
    for (const [label, output] of outputs) {
      const fetch = async () => jsonResponse({ id: "pred-1", status: "succeeded", output });
      const result = await replicatePoll({ state, apiKey, fetch: fetch as never });
      if (result.status !== "completed") throw new Error(`expected completed for ${label}`);
      expect(result.media.url, label).toBe("https://replicate.test/a.png");
    }
  });

  it("refuses a success that carries no media url", async () => {
    // Succeeded with nothing to fetch is a broken model, and calling it completed would attach an
    // empty asset to the node and close the task.
    const state: ReplicatePollState = { predictionId: "pred-1", getUrl: `${baseUrl}/predictions/pred-1` };
    const fetch = async () => jsonResponse({ id: "pred-1", status: "succeeded", output: null });
    await expect(replicatePoll({ state, apiKey, fetch: fetch as never }))
      .rejects.toThrow(/no media URL/);
  });

  it("does not mistake the polling address for a result", async () => {
    // `urls.get` is an https string sitting in the same document as the output. A search that walks
    // every key would return it and hand the host a JSON body to save as a video.
    const state: ReplicatePollState = { predictionId: "pred-1", getUrl: `${baseUrl}/predictions/pred-1` };
    const fetch = async () => jsonResponse({
      id: "pred-1",
      status: "succeeded",
      urls: { get: "https://api.replicate.test/v1/predictions/pred-1" },
      output: null,
    });
    await expect(replicatePoll({ state, apiKey, fetch: fetch as never }))
      .rejects.toThrow(/no media URL/);
  });

  it("surfaces a failed read rather than reporting the work unfinished", async () => {
    // A refused read is not evidence that the job is still running. Reporting accepted would retry
    // forever against an endpoint that will keep refusing.
    const state: ReplicatePollState = { predictionId: "pred-1", getUrl: `${baseUrl}/predictions/pred-1` };
    const fetch = async () => jsonResponse({ detail: "prediction not found" }, { ok: false });
    await expect(replicatePoll({ state, apiKey, fetch: fetch as never }))
      .rejects.toThrow(/prediction not found/);
  });

  it("never sleeps", async () => {
    // The point of the split is that neither half decides how long to wait. A timer in here would
    // reintroduce a ceiling that no Model Card asked for.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./replicate-executor.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/setTimeout|setInterval|sleep\(/);
    expect(source).not.toMatch(/for \(let attempt/);
  });
});
