import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  sunoPoll,
  sunoSubmit,
  type SunoPollState,
  type SunoResponse,
} from "./suno-executor";

/**
 * Suno's task API, translated rather than waited on.
 *
 * The host used to run this inline: create the task, then loop up to 120 times five seconds apart,
 * then download. Ten minutes was nobody's considered figure, and it sat beside six other loops with
 * six other ceilings. Worse, the task id lived in a local variable for the whole ten minutes, so a
 * host that stopped mid-loop lost a generation Suno was still billing for.
 *
 * Split in two, neither half waits. Submit hands back the task id; poll answers from a single
 * record-info call. How often to ask, and for how long, stops being Suno's opinion.
 */
describe("suno executor", () => {
  const apiKey = "test-key";
  const model = "V4_5";
  const callbackUrl = "https://callback.test/suno";
  const baseUrl = "https://suno.test";

  function response(body: Record<string, unknown>, ok = true): SunoResponse {
    return {
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? "OK" : "Internal Server Error",
      json: async () => body,
    };
  }

  /** Suno wraps every reply in `{ code, msg, data }`, so success needs both HTTP ok and code 200. */
  function envelope(data: Record<string, unknown>): Record<string, unknown> {
    return { code: 200, msg: "success", data };
  }

  function recordInfo(data: Record<string, unknown>): SunoResponse {
    return response(envelope(data));
  }

  describe("submit", () => {
    it("returns Suno's task id as poll state instead of waiting for it", async () => {
      const result = await sunoSubmit({
        baseUrl,
        apiKey,
        callbackUrl,
        model,
        prompt: "a quiet piano piece",
        fetch: async () => response(envelope({ taskId: "task-1" })),
      });
      expect(result.pollState).toEqual({ taskId: "task-1" });
    });

    it("refuses a create that carries no task id", async () => {
      // Suno may have started work regardless. Reporting success would leave the host holding a
      // billed task it has no id for, and no way to ever ask about it.
      await expect(sunoSubmit({
        baseUrl,
        apiKey,
        callbackUrl,
        model,
        prompt: "a quiet piano piece",
        fetch: async () => response(envelope({})),
      })).rejects.toThrow(/no taskId/);
    });

    it("treats a non-200 envelope code as failure even when HTTP succeeded", async () => {
      // Suno answers 200 OK and puts the real verdict in the body. Trusting the HTTP status alone
      // would read a rejection as a successful create and then poll an id that never existed.
      await expect(sunoSubmit({
        baseUrl,
        apiKey,
        callbackUrl,
        model,
        prompt: "a quiet piano piece",
        fetch: async () => response({ code: 429, msg: "insufficient credits" }),
      })).rejects.toThrow(/insufficient credits/);
    });

    it("requires a public HTTPS callback address", async () => {
      // Suno will not accept a task without one, so this fails before spending a request. A plain
      // HTTP address is refused for the same reason Suno refuses it: the callback carries the
      // finished track.
      for (const bad of [undefined, "", "http://callback.test/suno"]) {
        await expect(sunoSubmit({
          baseUrl,
          apiKey,
          callbackUrl: bad,
          model,
          prompt: "a quiet piano piece",
          fetch: async () => response(envelope({ taskId: "task-1" })),
        })).rejects.toThrow(/HTTPS callbackUrl/);
      }
    });

    it("sends custom mode only when both style and title are present", async () => {
      const bodies: Array<Record<string, unknown>> = [];
      const capture = async (_url: string, init?: { body?: string }) => {
        bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
        return response(envelope({ taskId: "task-1" }));
      };

      await sunoSubmit({
        baseUrl, apiKey, callbackUrl, model, prompt: "p", fetch: capture,
        modelParams: { style: "ambient", title: "Dusk" },
      });
      expect(bodies[0]).toMatchObject({ customMode: true, style: "ambient", title: "Dusk" });

      await sunoSubmit({ baseUrl, apiKey, callbackUrl, model, prompt: "p", fetch: capture });
      expect(bodies[1]).toMatchObject({ customMode: false });
      expect(bodies[1]).not.toHaveProperty("style");
    });

    it("refuses custom mode with only half of what it needs", async () => {
      // Suno rejects this itself, but only after the request. Catching it here keeps a guaranteed
      // rejection from costing a round trip.
      for (const half of [{ style: "ambient" }, { title: "Dusk" }]) {
        await expect(sunoSubmit({
          baseUrl, apiKey, callbackUrl, model, prompt: "p", modelParams: half,
          fetch: async () => response(envelope({ taskId: "task-1" })),
        })).rejects.toThrow(/both style and title/);
      }
    });
  });

  describe("poll", () => {
    const state: SunoPollState = { taskId: "task-1" };

    it("reports still-running work as unfinished, with the same state", async () => {
      const result = await sunoPoll({
        baseUrl, apiKey, state,
        fetch: async () => recordInfo({ status: "PENDING" }),
      });
      expect(result.status).toBe("accepted");
      if (result.status !== "accepted") throw new Error("expected accepted");
      expect(result.pollState).toEqual(state);
    });

    it("treats a missing status as still running rather than as an answer", async () => {
      // A record-info reply without a status is Suno not having got to the task yet. Reading the
      // absence as terminal would fail a job that is merely young.
      const result = await sunoPoll({
        baseUrl, apiKey, state,
        fetch: async () => recordInfo({}),
      });
      expect(result.status).toBe("accepted");
    });

    it("surfaces every terminal failure Suno reports rather than waiting forever", async () => {
      const terminal = [
        "CREATE_TASK_FAILED",
        "GENERATE_AUDIO_FAILED",
        "CALLBACK_EXCEPTION",
        "SENSITIVE_WORD_ERROR",
      ];
      for (const status of terminal) {
        await expect(sunoPoll({
          baseUrl, apiKey, state,
          fetch: async () => recordInfo({ status, errorMessage: `refused: ${status}` }),
        })).rejects.toThrow(new RegExp(`refused: ${status}`));
      }
    });

    it("falls back to the status name when Suno gives no reason", async () => {
      await expect(sunoPoll({
        baseUrl, apiKey, state,
        fetch: async () => recordInfo({ status: "SENSITIVE_WORD_ERROR" }),
      })).rejects.toThrow(/SENSITIVE_WORD_ERROR/);
    });

    it("treats a non-200 envelope code on status as failure", async () => {
      await expect(sunoPoll({
        baseUrl, apiKey, state,
        fetch: async () => response({ code: 404, msg: "task not found" }),
      })).rejects.toThrow(/task not found/);
    });

    it("returns the audio url once Suno reports success", async () => {
      const calls: string[] = [];
      const result = await sunoPoll({
        baseUrl, apiKey, state,
        fetch: async (url) => {
          calls.push(url);
          return recordInfo({
            status: "SUCCESS",
            response: { sunoData: [{ audioUrl: "https://suno.test/track.mp3", duration: 132.5 }] },
          });
        },
      });
      expect(result.status).toBe("completed");
      if (result.status !== "completed") throw new Error("expected completed");
      expect(result.media.url).toBe("https://suno.test/track.mp3");
      expect(result.requestId).toBe("task-1");
      // One record-info call per poll. Looping here would put the wait back where it was.
      expect(calls).toHaveLength(1);
    });

    it("converts Suno's seconds into the milliseconds the host stores", async () => {
      // Suno reports duration in seconds while every other provider in this plugin reports
      // milliseconds. Dropping the conversion silently makes a two-minute track look like a
      // two-millisecond one.
      const result = await sunoPoll({
        baseUrl, apiKey, state,
        fetch: async () => recordInfo({
          status: "SUCCESS",
          response: { sunoData: [{ audioUrl: "https://suno.test/track.mp3", duration: 132.5 }] },
        }),
      });
      if (result.status !== "completed") throw new Error("expected completed");
      expect(result.media.durationMs).toBe(132500);
    });

    it("refuses a success that carries no audio url", async () => {
      // Suno says SUCCESS before the track is addressable in at least some cases. Returning a
      // completion with nothing to fetch would mark the node done and leave it empty.
      await expect(sunoPoll({
        baseUrl, apiKey, state,
        fetch: async () => recordInfo({ status: "SUCCESS", response: { sunoData: [{}] } }),
      })).rejects.toThrow(/no audioUrl/);
    });

    it("asks about the task by id and nothing else", async () => {
      const calls: string[] = [];
      await sunoPoll({
        baseUrl, apiKey, state: { taskId: "task with spaces" },
        fetch: async (url) => {
          calls.push(url);
          return recordInfo({ status: "PENDING" });
        },
      });
      // Suno addresses a task by id alone, so that is all the poll state carries. An unencoded id
      // would truncate the query at the first space.
      expect(calls[0]).toBe(`${baseUrl}/api/v1/generate/record-info?taskId=task%20with%20spaces`);
    });
  });

  it("never sleeps", () => {
    // The point of the split is that neither half decides how long to wait. A timer in here would
    // reintroduce a ceiling that no Model Card asked for.
    const source = readFileSync(new URL("./suno-executor.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/setTimeout|setInterval|sleep\(/);
    expect(source).not.toMatch(/for \(let attempt/);
  });
});
