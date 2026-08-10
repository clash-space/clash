import { describe, expect, it } from "vitest";

import {
  googleagentSubmit,
  googleagentPoll,
  type GoogleAgentPlatformPollState,
} from "./google-agent-platform-executor";

/**
 * Vertex long-running operations, translated rather than waited on.
 *
 * The host used to submit, then loop up to 108 times five seconds apart, then read the result out
 * of the last poll. Nine minutes was nobody's decision, and it sat beside six other loops with six
 * other ceilings. The operation name lived in a local variable for the whole of it, so a host that
 * stopped mid-loop lost a video Vertex was still rendering and still charging for.
 *
 * Split in two, neither half waits. Submit hands back the operation name; poll asks once and
 * reports what Vertex said.
 */
describe("google agent platform executor", () => {
  const accessToken = "ya29.test-token";
  const state: GoogleAgentPlatformPollState = {
    operationName: "projects/p/locations/us-central1/operations/op-1",
    project: "p",
    location: "us-central1",
    model: "veo-3.0-generate-001",
  };

  function textResponse(body: unknown, init: { ok?: boolean; statusText?: string } = {}) {
    return {
      ok: init.ok ?? true,
      status: init.ok === false ? 500 : 200,
      statusText: init.statusText ?? "OK",
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  }

  it("returns the operation name as poll state instead of waiting for it", async () => {
    const fetch = async () => textResponse({ name: state.operationName });
    const result = await googleagentSubmit({
      project: "p",
      location: "us-central1",
      model: "veo-3.0-generate-001",
      accessToken,
      body: { instances: [{ prompt: "a cat" }] },
      fetch: fetch as never,
    });
    expect(result.pollState).toEqual(state);
  });

  it("submits to predictLongRunning on the location's own host", async () => {
    // A regional operation started on the global host is not visible to the regional one, so the
    // host prefix is part of addressing the job, not cosmetic.
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(String(url));
      return textResponse({ name: state.operationName });
    };
    await googleagentSubmit({
      project: "p",
      location: "us-central1",
      model: "veo-3.0-generate-001",
      accessToken,
      body: {},
      fetch: fetch as never,
    });
    expect(calls[0]).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1"
      + "/publishers/google/models/veo-3.0-generate-001:predictLongRunning",
    );
  });

  it("addresses the global location without a regional prefix", async () => {
    // Vertex spells `global` as the bare host. Prefixing it yields a hostname that does not resolve.
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(String(url));
      return textResponse({ name: "operations/op-2" });
    };
    await googleagentSubmit({
      project: "p",
      location: "global",
      model: "veo-3.0-generate-001",
      accessToken,
      body: {},
      fetch: fetch as never,
    });
    expect(calls[0]).toContain("https://aiplatform.googleapis.com/v1/projects/p/locations/global/");
  });

  it("refuses a submission Vertex did not name", async () => {
    // Without an operation name there is nothing to poll. Reporting success would leave the host
    // waiting on a render that may well be running, and billed, with no way to ask about it.
    const fetch = async () => textResponse({ metadata: {} });
    await expect(googleagentSubmit({
      project: "p",
      location: "us-central1",
      model: "veo-3.0-generate-001",
      accessToken,
      body: {},
      fetch: fetch as never,
    })).rejects.toThrow(/operation name/i);
  });

  it("surfaces a rejected submission with the message Vertex gave", async () => {
    const fetch = async () => textResponse(
      { error: { message: "Quota exceeded for veo-3.0-generate-001" } },
      { ok: false },
    );
    await expect(googleagentSubmit({
      project: "p",
      location: "us-central1",
      model: "veo-3.0-generate-001",
      accessToken,
      body: {},
      fetch: fetch as never,
    })).rejects.toThrow(/Quota exceeded/);
  });

  it("reports unfinished work as accepted, with the same state", async () => {
    // Vertex signals progress by omitting `done` rather than by naming a state, so anything that is
    // not explicitly done is still running.
    const fetch = async () => textResponse({ name: state.operationName });
    const result = await googleagentPoll({ state, accessToken, fetch: fetch as never });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("expected accepted");
    expect(result.pollState).toEqual(state);
  });

  it("asks about the operation by name, in the body of a POST", async () => {
    // fetchPredictOperation takes the operation in its payload, unlike a queue that would put an id
    // in the path. A GET here returns the model's metadata and never reports the job as done.
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    const fetch = async (url: string, init?: { method?: string; body?: string }) => {
      seen.push({ url: String(url), method: init?.method, body: init?.body });
      return textResponse({ name: state.operationName });
    };
    await googleagentPoll({ state, accessToken, fetch: fetch as never });
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toContain(":fetchPredictOperation");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ operationName: state.operationName });
  });

  it("throws when Vertex reports the finished operation as failed", async () => {
    // A failed operation still arrives as a normal 200 with `done` set, so the error is only
    // visible inside the payload. Missing it would return an operation with no video as success.
    const fetch = async () => textResponse({
      done: true,
      error: { code: 3, message: "Video generation failed: unsafe prompt" },
    });
    await expect(googleagentPoll({ state, accessToken, fetch: fetch as never }))
      .rejects.toThrow(/unsafe prompt/);
  });

  it("throws when the poll itself is rejected", async () => {
    const fetch = async () => textResponse(
      { error: { message: "Request had invalid authentication credentials" } },
      { ok: false },
    );
    await expect(googleagentPoll({ state, accessToken, fetch: fetch as never }))
      .rejects.toThrow(/invalid authentication credentials/);
  });

  it("returns the inline video once the operation is done", async () => {
    // Vertex hands the video back as base64 in the operation payload rather than as a link, so
    // there is no url to return and nothing further to download.
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(String(url));
      return textResponse({
        done: true,
        response: {
          videos: [{ bytesBase64Encoded: "AAECAw==", mimeType: "video/mp4" }],
        },
      });
    };
    const result = await googleagentPoll({ state, accessToken, fetch: fetch as never });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed");
    expect(result.media).toEqual({ dataBase64: "AAECAw==", mimeType: "video/mp4" });
    expect(result.requestId).toBe(state.operationName);
    // One request per poll. Looping in here would put the ceiling back.
    expect(calls).toHaveLength(1);
  });

  it("reads the sample shapes Vertex has used", async () => {
    // The field has been spelled three ways across Vertex revisions and the samples may be wrapped
    // in a `video` object or not. All of these have been seen from the live API.
    const shapes = [
      { generated_samples: [{ video: { bytesBase64Encoded: "AA==", mimeType: "video/mp4" } }] },
      { generatedVideos: [{ video: { data: "AA==", mime_type: "video/webm" } }] },
      { videos: [{ bytesBase64Encoded: "AA==" }] },
    ];
    for (const response of shapes) {
      const fetch = async () => textResponse({ done: true, response });
      const result = await googleagentPoll({ state, accessToken, fetch: fetch as never });
      expect(result.status, JSON.stringify(response)).toBe("completed");
    }
  });

  it("refuses a GCS uri in place of inline bytes, naming it", async () => {
    // Vertex returns a `gs://` uri when the request asked for one, and that is not fetchable with
    // the bearer token in hand. Failing here with the uri quoted says what happened; letting it
    // through produces a download error somewhere else that reads like a network fault.
    const fetch = async () => textResponse({
      done: true,
      response: { videos: [{ gcsUri: "gs://bucket/out.mp4" }] },
    });
    await expect(googleagentPoll({ state, accessToken, fetch: fetch as never }))
      .rejects.toThrow(/gs:\/\/bucket\/out\.mp4/);
  });

  it("throws when a done operation carries neither video nor uri", async () => {
    const fetch = async () => textResponse({ done: true, response: { videos: [] } });
    await expect(googleagentPoll({ state, accessToken, fetch: fetch as never }))
      .rejects.toThrow(/no video/i);
  });

  it("never sleeps", async () => {
    // The point of the split is that neither half decides how long to wait. A timer in here would
    // reintroduce a ceiling that no Model Card asked for.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./google-agent-platform-executor.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/setTimeout|setInterval|sleep\(/);
    expect(source).not.toMatch(/for \(let attempt/);
  });
});
