import { describe, expect, it } from "vitest";

import { kieSubmit, kiePoll, type KiePollState } from "./kie-executor";

/**
 * KIE's job API, translated rather than waited on.
 *
 * The host used to do this inline: create a task, then loop up to 240 times a second apart, then
 * download. Four minutes was the ceiling, and it was not a number anyone chose — a start/end-frame
 * video measured on this machine took 275 seconds, close enough that ordinary work was already at
 * risk of being cut off. The loop also kept the task id in a local variable, so a host that stopped
 * partway lost a generation KIE had already charged for.
 *
 * Split in two, neither half waits. Submit hands back what KIE needs to be asked again; poll answers
 * from one status check.
 */
describe("kie executor", () => {
  const model = "google/veo3-fast";
  const apiKey = "test-key";

  function jsonResponse(body: unknown, init: { ok?: boolean; statusText?: string } = {}) {
    return {
      ok: init.ok ?? true,
      status: init.ok === false ? 500 : 200,
      statusText: init.statusText ?? "OK",
      json: async () => body,
    };
  }

  it("returns KIE's task id as poll state instead of waiting for it", async () => {
    const fetch = async () => jsonResponse({ code: 200, data: { taskId: "task-1" } });
    const result = await kieSubmit({
      model,
      apiKey,
      input: { prompt: "a cat" },
      fetch: fetch as never,
    });
    expect(result.pollState).toEqual({ taskId: "task-1", model });
  });

  it("finds the task id in any of the three places KIE has been seen to put it", async () => {
    // The original tried `data.taskId`, then `taskId`, then `id`, in that order. A fallback chain
    // that specific is a record of responses actually received, so narrowing it would break
    // whichever model prompted each entry.
    const shapes: Array<[Record<string, unknown>, string]> = [
      [{ data: { taskId: "from-data" }, taskId: "outer", id: "ident" }, "from-data"],
      [{ taskId: "outer", id: "ident" }, "outer"],
      [{ id: "ident" }, "ident"],
    ];
    for (const [body, expected] of shapes) {
      const fetch = async () => jsonResponse(body);
      const result = await kieSubmit({ model, apiKey, input: {}, fetch: fetch as never });
      expect(result.pollState.taskId, JSON.stringify(body)).toBe(expected);
    }
  });

  it("refuses a submission KIE did not acknowledge", async () => {
    // Without a task id there is nothing to poll, and reporting success would leave the host
    // waiting on work it can never ask about while KIE may well be running it.
    const fetch = async () => jsonResponse({ code: 200, data: {} });
    await expect(kieSubmit({
      model,
      apiKey,
      input: {},
      fetch: fetch as never,
    })).rejects.toThrow(/taskId/);
  });

  it("treats an error code in the body as a failure even when the request returned 200", async () => {
    // KIE reports application errors in `code` while the transport still says OK. Trusting the HTTP
    // status alone would read the error envelope as a task and poll a task id that never existed.
    const fetch = async () => jsonResponse({ code: 401, msg: "invalid api key" });
    await expect(kieSubmit({
      model,
      apiKey,
      input: {},
      fetch: fetch as never,
    })).rejects.toThrow(/invalid api key/);
  });

  it("reports still-running work as unfinished, with the same state", async () => {
    const state: KiePollState = { taskId: "task-1", model };
    const fetch = async () => jsonResponse({ code: 200, data: { state: "generating" } });
    const result = await kiePoll({ state, apiKey, fetch: fetch as never });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("expected accepted");
    expect(result.pollState).toEqual(state);
  });

  it("reads success and failure from successFlag as well as the state strings", async () => {
    // Two vocabularies, because KIE's models do not agree: some return a numeric successFlag, others
    // a state string. The flag wins where both appear, matching the original's order of checks.
    const pending = { code: 200, data: { state: "waiting" } };
    const succeeded = { code: 200, data: { successFlag: 1, resultUrls: ["https://kie.test/a.mp4"] } };

    const pendingResult = await kiePoll({
      state: { taskId: "t", model },
      apiKey,
      fetch: (async () => jsonResponse(pending)) as never,
    });
    expect(pendingResult.status).toBe("accepted");

    const succeededResult = await kiePoll({
      state: { taskId: "t", model },
      apiKey,
      fetch: (async () => jsonResponse(succeeded)) as never,
    });
    expect(succeededResult.status).toBe("completed");

    for (const flag of [2, 3, "2", "3"]) {
      // Asserted against the failure message specifically. A bare /KIE/ would also match the
      // no-media-url error raised further down, so removing the failure branch entirely would still
      // have looked correct here.
      await expect(kiePoll({
        state: { taskId: "t", model },
        apiKey,
        fetch: (async () => jsonResponse({
          code: 200,
          data: { successFlag: flag, errorMessage: "generation rejected" },
        })) as never,
      }), String(flag)).rejects.toThrow(/KIE request failed: generation rejected/);
    }
  });

  it("surfaces a failed job as an error rather than an endless wait", async () => {
    const state: KiePollState = { taskId: "task-1", model };
    const fetch = async () => jsonResponse({
      code: 200,
      data: { state: "failed", errorMessage: "content rejected" },
    });
    await expect(kiePoll({ state, apiKey, fetch: fetch as never }))
      .rejects.toThrow(/content rejected/);
  });

  it("keeps a numeric error code in the failure it reports", async () => {
    // KIE sends errorCode as a number. Reading only strings would skip it and fall back to a vaguer
    // message, discarding the one part of the failure that says which failure it was.
    const fetch = async () => jsonResponse({
      code: 200,
      data: { state: "failed", errorCode: 422 },
    });
    await expect(kiePoll({
      state: { taskId: "task-1", model },
      apiKey,
      fetch: fetch as never,
    })).rejects.toThrow(/422/);
  });

  it("returns the media url once KIE reports completion", async () => {
    const state: KiePollState = { taskId: "task-1", model };
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return jsonResponse({
        code: 200,
        data: { successFlag: 1, resultUrls: ["https://kie.test/out.mp4"] },
      });
    };
    const result = await kiePoll({ state, apiKey, fetch: fetch as never });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("expected completed");
    expect(result.media.url).toBe("https://kie.test/out.mp4");
    expect(result.taskId).toBe("task-1");
    // One status check per poll. Looping here would put the wait back where it was.
    expect(calls).toBe(1);
  });

  it("digs the url out of the nested shapes KIE returns it in", async () => {
    // The url arrives under a different key per model, sometimes stringified inside another field.
    // The original walked a fixed list of keys recursively; the shapes below are the ones that list
    // exists to cover.
    const shapes: Array<[Record<string, unknown>, string]> = [
      [{ resultUrls: ["https://kie.test/1.mp4"] }, "https://kie.test/1.mp4"],
      [{ response: { resultUrls: ["https://kie.test/2.mp4"] } }, "https://kie.test/2.mp4"],
      [{ output: { video: { url: "https://kie.test/3.mp4" } } }, "https://kie.test/3.mp4"],
      [{ images: ["https://kie.test/4.png"] }, "https://kie.test/4.png"],
    ];
    for (const [data, expected] of shapes) {
      const fetch = async () => jsonResponse({ code: 200, data: { successFlag: 1, ...data } });
      const result = await kiePoll({
        state: { taskId: "t", model },
        apiKey,
        fetch: fetch as never,
      });
      if (result.status !== "completed") throw new Error(`expected completed for ${JSON.stringify(data)}`);
      expect(result.media.url, JSON.stringify(data)).toBe(expected);
    }
  });

  it("refuses a success that carries no media url", async () => {
    // A task KIE calls finished but hands back nothing is not a result. Returning it as completed
    // would produce an asset node pointing at nothing, which reads as a delivered generation.
    const fetch = async () => jsonResponse({ code: 200, data: { successFlag: 1 } });
    await expect(kiePoll({
      state: { taskId: "task-1", model },
      apiKey,
      fetch: fetch as never,
    })).rejects.toThrow(/media URL/);
  });

  it("never sleeps", async () => {
    // The point of the split is that neither half decides how long to wait. A timer in here would
    // reintroduce a ceiling that no Model Card asked for.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./kie-executor.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/setTimeout|setInterval|sleep\(/);
    expect(source).not.toMatch(/for \(let attempt/);
  });
});
