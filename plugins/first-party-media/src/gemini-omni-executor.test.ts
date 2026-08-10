import { describe, expect, it } from "vitest";

import {
  geminiSubmit,
  geminiPoll,
  type GeminiPollState,
} from "./gemini-omni-executor";

/**
 * Gemini Omni's interaction API, translated rather than waited on.
 *
 * The host used to run this inline as 120 attempts five seconds apart, and threw
 * "timed out after 10 minutes" at the end. Ten minutes was not measured against anything: it sat
 * beside six other loops with six other ceilings. The interaction id also lived in a local
 * variable, so a host that stopped mid-loop lost a video Google was already rendering and billing.
 *
 * Split in two, neither half waits. Submit reports what Google called the interaction; poll asks
 * once and reports what Google said.
 */
describe("gemini omni executor", () => {
  const apiKey = "test-key";
  const model = "models/gemini-omni-video";

  function jsonResponse(body: unknown, init: { ok?: boolean; statusText?: string } = {}) {
    return {
      ok: init.ok ?? true,
      status: init.ok === false ? 400 : 200,
      statusText: init.statusText ?? "OK",
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  }

  const submitArgs = {
    apiKey,
    model,
    input: [{ type: "text" as const, text: "a cat" }],
    aspectRatio: "16:9" as const,
    duration: 5,
  };

  describe("submit", () => {
    it("returns the interaction id as poll state instead of waiting for it", async () => {
      const fetch = async () => jsonResponse({ id: "interactions/abc", status: "queued" });
      const result = await geminiSubmit({ ...submitArgs, fetch: fetch as never });
      expect(result.pollState).toEqual({ phase: "interaction", interactionId: "interactions/abc" });
    });

    it("accepts the id under either name Google uses for it", async () => {
      // The create response carries `id` on some model families and `name` on others. Reading only
      // one of them would strand every interaction from the other.
      const fetch = async () => jsonResponse({ name: "interactions/xyz", status: "queued" });
      const result = await geminiSubmit({ ...submitArgs, fetch: fetch as never });
      expect(result.pollState.interactionId).toBe("interactions/xyz");
    });

    it("refuses a submission Google did not name", async () => {
      // Without an id there is nothing to poll. Reporting success would leave the host waiting on a
      // render that is running, and billable, with no way to ask after it.
      const fetch = async () => jsonResponse({ status: "queued" });
      await expect(geminiSubmit({ ...submitArgs, fetch: fetch as never }))
        .rejects.toThrow(/did not include an id/i);
    });

    it("refuses work that arrives already dead", async () => {
      // A create call can come back terminal. Handing that to the host as accepted would spend the
      // whole poll budget re-reading a failure that was known at submit time.
      const fetch = async () => jsonResponse({
        id: "interactions/abc",
        status: "failed",
        error: { message: "safety" },
      });
      await expect(geminiSubmit({ ...submitArgs, fetch: fetch as never }))
        .rejects.toThrow(/safety/);
    });

    it("reports an HTTP failure with Google's own message", async () => {
      const fetch = async () => jsonResponse(
        { error: { message: "quota exhausted" } },
        { ok: false },
      );
      await expect(geminiSubmit({ ...submitArgs, fetch: fetch as never }))
        .rejects.toThrow(/quota exhausted/);
    });

    it("requires exactly one credential", async () => {
      const fetch = async () => jsonResponse({ id: "interactions/abc" });
      await expect(geminiSubmit({
        ...submitArgs,
        apiKey: undefined,
        fetch: fetch as never,
      })).rejects.toThrow(/requires a Google API key/i);
      await expect(geminiSubmit({
        ...submitArgs,
        gatewayToken: "cf-token",
        fetch: fetch as never,
      })).rejects.toThrow(/either/i);
    });

    it("refuses to send a Cloudflare token anywhere but Cloudflare", async () => {
      // The token is a bearer credential. Posting it to whatever base URL happened to be configured
      // would hand it to that host, so the destination is checked before the request is built.
      const fetch = async () => jsonResponse({ id: "interactions/abc" });
      await expect(geminiSubmit({
        ...submitArgs,
        apiKey: undefined,
        gatewayToken: "cf-token",
        baseUrl: "https://evil.test/v1beta",
        fetch: fetch as never,
      })).rejects.toThrow(/Cloudflare/i);
    });
  });

  describe("poll", () => {
    const state: GeminiPollState = { phase: "interaction", interactionId: "interactions/abc" };

    it("reports still-running work as unfinished, with the same state", async () => {
      const fetch = async () => jsonResponse({ id: "interactions/abc", status: "in_progress" });
      const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
      expect(result.status).toBe("accepted");
      if (result.status !== "accepted") throw new Error("expected accepted");
      expect(result.pollState).toEqual(state);
    });

    it("surfaces a failed interaction as an error rather than an endless wait", async () => {
      const fetch = async () => jsonResponse({
        id: "interactions/abc",
        status: "failed",
        error: { message: "capacity" },
      });
      await expect(geminiPoll({ state, apiKey, fetch: fetch as never }))
        .rejects.toThrow(/capacity/);
    });

    it("treats every terminal spelling Google uses as terminal", async () => {
      // `incomplete` reads like a stage on the way to done and is not: Google returns it when a
      // render stops early, typically on a safety refusal. Polling through it would burn the whole
      // budget on an interaction that will never progress.
      for (const status of ["failed", "cancelled", "canceled", "error", "incomplete"]) {
        const fetch = async () => jsonResponse({ id: "interactions/abc", status });
        await expect(
          geminiPoll({ state, apiKey, fetch: fetch as never }),
          status,
        ).rejects.toThrow(new RegExp(status, "i"));
      }
    });

    it("accepts every spelling of success", async () => {
      // Three spellings reach this code from different model families, and a missed one reads as
      // still-running forever.
      for (const status of ["completed", "succeeded", "success"]) {
        const fetch = async () => jsonResponse({
          id: "interactions/abc",
          status,
          steps: [{ type: "video", uri: "https://cdn.test/out.mp4", mime_type: "video/mp4" }],
        });
        const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
        expect(result.status, status).toBe("completed");
      }
    });

    it("reads a status Google shouted or padded", async () => {
      // Status arrives with inconsistent casing across model families; comparing raw would treat
      // COMPLETED as unfinished.
      const fetch = async () => jsonResponse({
        id: "interactions/abc",
        status: "  COMPLETED  ",
        steps: [{ type: "video", uri: "https://cdn.test/out.mp4", mime_type: "video/mp4" }],
      });
      const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
      expect(result.status).toBe("completed");
    });

    it("returns the media url once Google reports completion", async () => {
      const calls: string[] = [];
      const fetch = async (url: string) => {
        calls.push(String(url));
        return jsonResponse({
          id: "interactions/abc",
          status: "completed",
          steps: [{ type: "video", uri: "https://cdn.test/out.mp4", mime_type: "video/mp4" }],
        });
      };
      const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
      if (result.status !== "completed") throw new Error("expected completed");
      if (result.media.kind !== "url") throw new Error("expected a url");
      expect(result.media.url).toBe("https://cdn.test/out.mp4");
      expect(result.media.mimeType).toBe("video/mp4");
      // One read per poll. Looping here would put the wait back where it was.
      expect(calls).toHaveLength(1);
    });

    it("finds the video however deeply Google nested it", async () => {
      // The output has been observed under `steps`, and under keys that vary by model family, so
      // the search walks the payload rather than trusting one path.
      const fetch = async () => jsonResponse({
        id: "interactions/abc",
        status: "completed",
        steps: [
          { type: "text", text: "thinking" },
          { outputs: { parts: [{ mime_type: "video/mp4", uri: "https://cdn.test/deep.mp4" }] } },
        ],
      });
      const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
      if (result.status !== "completed") throw new Error("expected completed");
      if (result.media.kind !== "url") throw new Error("expected a url");
      expect(result.media.url).toBe("https://cdn.test/deep.mp4");
    });

    it("returns inline bytes when Google delivered them instead of a link", async () => {
      const fetch = async () => jsonResponse({
        id: "interactions/abc",
        status: "completed",
        steps: [{ type: "video", data: "AAAA", mime_type: "video/mp4" }],
      });
      const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
      if (result.status !== "completed") throw new Error("expected completed");
      if (result.media.kind !== "inline") throw new Error("expected inline data");
      expect(result.media.dataBase64).toBe("AAAA");
    });

    it("refuses a completion that carried no video at all", async () => {
      const fetch = async () => jsonResponse({ id: "interactions/abc", status: "completed" });
      await expect(geminiPoll({ state, apiKey, fetch: fetch as never }))
        .rejects.toThrow(/without a video/i);
    });
  });

  describe("poll, waiting on the Files API", () => {
    const state: GeminiPollState = { phase: "interaction", interactionId: "interactions/abc" };
    const filesUri = "https://generativelanguage.googleapis.com/v1beta/files/vid123";

    function completedWithFile() {
      return {
        id: "interactions/abc",
        status: "completed",
        steps: [{ type: "video", uri: filesUri, mime_type: "video/mp4" }],
      };
    }

    it("hands back a second phase when the rendered file is still processing", async () => {
      // Google finishing the render and Google having a downloadable file are two separate waits.
      // The old code slept through the second one inside the download helper, up to another ten
      // minutes that nothing accounted for.
      const fetch = async (url: string) => jsonResponse(
        String(url).includes("/files/") ? { state: "PROCESSING" } : completedWithFile(),
      );
      const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
      expect(result.status).toBe("accepted");
      if (result.status !== "accepted") throw new Error("expected accepted");
      expect(result.pollState).toEqual({
        phase: "file",
        interactionId: "interactions/abc",
        fileId: "vid123",
        filesBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        mimeType: "video/mp4",
      });
    });

    it("completes in one poll when the file is already active", async () => {
      const fetch = async (url: string) => jsonResponse(
        String(url).includes("/files/") ? { state: "ACTIVE" } : completedWithFile(),
      );
      const result = await geminiPoll({ state, apiKey, fetch: fetch as never });
      if (result.status !== "completed") throw new Error("expected completed");
      if (result.media.kind !== "url") throw new Error("expected a url");
      expect(result.media.url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/files/vid123:download?alt=media",
      );
      expect(result.media.requiresProviderAuth).toBe(true);
    });

    it("resumes from the file phase without re-reading the interaction", async () => {
      const fileState: GeminiPollState = {
        phase: "file",
        interactionId: "interactions/abc",
        fileId: "vid123",
        filesBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        mimeType: "video/mp4",
      };
      const calls: string[] = [];
      const fetch = async (url: string) => {
        calls.push(String(url));
        return jsonResponse({ state: "ACTIVE" });
      };
      const result = await geminiPoll({ state: fileState, apiKey, fetch: fetch as never });
      expect(result.status).toBe("completed");
      expect(calls).toEqual([
        "https://generativelanguage.googleapis.com/v1beta/files/vid123",
      ]);
    });

    it("reads the file state whether Google nested it or not", async () => {
      // The Files API returns `state` as a bare string on one path and as `{ name }` on another.
      const fileState: GeminiPollState = {
        phase: "file",
        interactionId: "interactions/abc",
        fileId: "vid123",
        filesBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        mimeType: "video/mp4",
      };
      const fetch = async () => jsonResponse({ state: { name: "ACTIVE" } });
      const result = await geminiPoll({ state: fileState, apiKey, fetch: fetch as never });
      expect(result.status).toBe("completed");
    });

    it("surfaces a failed file rather than waiting for it", async () => {
      const fileState: GeminiPollState = {
        phase: "file",
        interactionId: "interactions/abc",
        fileId: "vid123",
        filesBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        mimeType: "video/mp4",
      };
      const fetch = async () => jsonResponse({ state: "FAILED" });
      await expect(geminiPoll({ state: fileState, apiKey, fetch: fetch as never }))
        .rejects.toThrow(/file processing failed/i);
    });
  });

  it("never sleeps", async () => {
    // The point of the split is that neither half decides how long to wait. A timer in here would
    // reintroduce a ceiling that no Model Card asked for, and both of Gemini's waits had one.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./gemini-omni-executor.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/setTimeout|setInterval|sleep\(/);
    expect(source).not.toMatch(/for \(let attempt/);
    expect(source).not.toMatch(/maxAttempts|pollIntervalMs/);
  });
});
