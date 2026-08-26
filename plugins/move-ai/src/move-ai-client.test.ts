import { describe, expect, it, vi } from "vitest";

import { ProviderExecutionError } from "@clash/action-sdk";

import {
  MOVE_AI_API_URL,
  moveAiPollJob,
  moveAiSubmitTake,
  type FetchLike,
} from "./move-ai-client.js";

/** A GraphQL POST envelope: `{ data: ... }` or `{ errors: [...] }` on HTTP 200. */
function graphqlResponse(status: number, body: unknown, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return JSON.stringify(body);
    },
  };
}

/** A raw S3-style PUT response: no JSON body. */
function putResponse(status: number, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return "";
    },
  };
}

function fetchSequence(
  ...responses: Array<ReturnType<typeof graphqlResponse> | ReturnType<typeof putResponse>>
) {
  let call = 0;
  return vi.fn<FetchLike>(async (_url, _init) => {
    const response = responses[call];
    call += 1;
    if (!response) throw new Error("fetch called more times than expected");
    return response;
  });
}

function bodyJson(init: { body?: string | Uint8Array } | undefined): any {
  return JSON.parse(init!.body as string);
}

const CREATE_FILE_OK = graphqlResponse(200, {
  data: { createFile: { id: "file_1", presignedUrl: "https://upload.example.test/file_1" } },
});
const TAKE_OK = graphqlResponse(200, {
  data: { createSingleCamTake: { id: "take_1" } },
});
const JOB_OK = graphqlResponse(200, {
  data: { createSingleCamJob: { id: "job_1", progress: { state: "NOT_STARTED", percentageComplete: 0 } } },
});
const PUT_OK = putResponse(200);

describe("moveAiSubmitTake", () => {
  it("fails before any request when the account has no apiKey stored", async () => {
    const fetch = vi.fn();
    await expect(
      moveAiSubmitTake({
        apiKey: "",
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "authentication_failed",
        retryable: false,
        requestState: "rejected",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an unsupported media type before any request", async () => {
    const fetch = vi.fn();
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "video/webm",
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: { code: "invalid_request", retryable: false, requestState: "rejected" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing media type before any request", async () => {
    const fetch = vi.fn();
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "",
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: { code: "invalid_request", requestState: "rejected" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("strips content-type parameters before matching video/mp4", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, PUT_OK, TAKE_OK, JOB_OK);
    await moveAiSubmitTake({
      apiKey: "sk-test",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "video/mp4; codecs=avc1",
      fetch,
    });
    const createFileCall = fetch.mock.calls[0]!;
    expect(bodyJson(createFileCall[1]).variables).toEqual({ type: "mp4" });
  });

  it("runs createFile, PUT, createSingleCamTake, createSingleCamJob in exact sequence with exact bodies", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, PUT_OK, TAKE_OK, JOB_OK);
    const bytes = new Uint8Array([9, 8, 7, 6]);

    const result = await moveAiSubmitTake({
      apiKey: "sk-raw-key",
      bytes,
      mediaType: "video/mp4",
      trackFingers: true,
      fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(4);

    // Step 1: createFile
    const [createFileUrl, createFileInit] = fetch.mock.calls[0]!;
    expect(createFileUrl).toBe(MOVE_AI_API_URL);
    expect(createFileInit!.method).toBe("POST");
    expect(createFileInit!.headers).toEqual({
      Authorization: "sk-raw-key",
      "content-type": "application/json",
    });
    const createFileBody = bodyJson(createFileInit);
    expect(createFileBody.query).toContain("createFile(type: $type)");
    expect(createFileBody.query).toContain("$type: String!");
    expect(createFileBody.variables).toEqual({ type: "mp4" });

    // Step 2: PUT to the presigned URL with the exact bytes, no Authorization header
    const [putUrl, putInit] = fetch.mock.calls[1]!;
    expect(putUrl).toBe("https://upload.example.test/file_1");
    expect(putInit!.method).toBe("PUT");
    expect(putInit!.body).toEqual(bytes);
    expect(putInit!.headers ?? {}).not.toHaveProperty("Authorization");
    expect(putInit!.headers ?? {}).not.toHaveProperty("authorization");

    // Step 3: createSingleCamTake
    const [takeUrl, takeInit] = fetch.mock.calls[2]!;
    expect(takeUrl).toBe(MOVE_AI_API_URL);
    expect(takeInit!.headers!.Authorization).toBe("sk-raw-key");
    const takeBody = bodyJson(takeInit);
    expect(takeBody.query).toContain("createSingleCamTake(sources: $sources)");
    expect(takeBody.query).toContain("$sources: [SourceInput!]!");
    expect(takeBody.variables).toEqual({
      sources: [{ deviceLabel: "cam01", fileId: "file_1", format: "MP4" }],
    });

    // Step 4: createSingleCamJob
    const [jobUrl, jobInit] = fetch.mock.calls[3]!;
    expect(jobUrl).toBe(MOVE_AI_API_URL);
    expect(jobInit!.headers!.Authorization).toBe("sk-raw-key");
    const jobBody = bodyJson(jobInit);
    expect(jobBody.query).toContain("createSingleCamJob(takeId: $takeId, options: $options, outputs: $outputs)");
    expect(jobBody.query).toContain("$takeId: String!");
    expect(jobBody.query).toContain("$options: OptionsInput");
    expect(jobBody.query).toContain("$outputs: [OutputType]");
    expect(jobBody.variables).toEqual({
      takeId: "take_1",
      options: { mocapModel: "S2", trackFingers: true },
      outputs: ["MAIN_GLB"],
    });

    // Only the accepted pollState is returned; nothing secret or intermediate leaks out.
    expect(result).toEqual({ status: "accepted", pollState: { jobId: "job_1" } });
    expect(Object.keys(result.pollState)).toEqual(["jobId"]);
  });

  it("maps video/quicktime to the MOV format and mov createFile type", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, PUT_OK, TAKE_OK, JOB_OK);
    await moveAiSubmitTake({
      apiKey: "sk-test",
      bytes: new Uint8Array([1]),
      mediaType: "video/quicktime",
      fetch,
    });
    expect(bodyJson(fetch.mock.calls[0]![1]).variables).toEqual({ type: "mov" });
    expect(bodyJson(fetch.mock.calls[2]![1]).variables.sources[0].format).toBe("MOV");
  });

  it("maps video/x-msvideo to the AVI format and avi createFile type", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, PUT_OK, TAKE_OK, JOB_OK);
    await moveAiSubmitTake({
      apiKey: "sk-test",
      bytes: new Uint8Array([1]),
      mediaType: "video/x-msvideo",
      fetch,
    });
    expect(bodyJson(fetch.mock.calls[0]![1]).variables).toEqual({ type: "avi" });
    expect(bodyJson(fetch.mock.calls[2]![1]).variables.sources[0].format).toBe("AVI");
  });

  it("includes only the boolean options actually supplied, alongside the fixed S2 mocapModel", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, PUT_OK, TAKE_OK, JOB_OK);
    await moveAiSubmitTake({
      apiKey: "sk-test",
      bytes: new Uint8Array([1]),
      mediaType: "video/mp4",
      fetch,
    });
    expect(bodyJson(fetch.mock.calls[3]![1]).variables.options).toEqual({
      mocapModel: "S2",
    });
  });

  it("forwards floorPlane and trackBall when both are supplied", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, PUT_OK, TAKE_OK, JOB_OK);
    await moveAiSubmitTake({
      apiKey: "sk-test",
      bytes: new Uint8Array([1]),
      mediaType: "video/mp4",
      floorPlane: false,
      trackBall: true,
      fetch,
    });
    expect(bodyJson(fetch.mock.calls[3]![1]).variables.options).toEqual({
      mocapModel: "S2",
      floorPlane: false,
      trackBall: true,
    });
  });

  it("converts a non-2xx createFile response into a rejected Provider failure and stops the sequence", async () => {
    const fetch = fetchSequence(graphqlResponse(401, { errors: [{ message: "Invalid key" }] }, "Unauthorized"));
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: { code: "authentication_failed", requestState: "rejected" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("parses GraphQL top-level errors on HTTP 200 as a rejected Provider failure", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, { errors: [{ message: "type must be one of mp4, mov, avi" }] }),
    );
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        message: "type must be one of mp4, mov, avi",
        requestState: "rejected",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails with invalid_response when createFile's data is missing id or presignedUrl", async () => {
    const fetch = fetchSequence(graphqlResponse(200, { data: { createFile: { id: "file_1" } } }));
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: { code: "invalid_response", requestState: "rejected" },
    });
  });

  it("fails with invalid_response on a malformed (non-JSON) GraphQL envelope", async () => {
    const fetch = fetchSequence({
      ok: true,
      status: 200,
      statusText: "",
      async text() {
        return "not json";
      },
    });
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "rejected" } });
  });

  it("converts a non-2xx PUT upload response into a rejected Provider failure and stops the sequence", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, putResponse(500, "Internal Server Error"));
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toBeInstanceOf(ProviderExecutionError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails with invalid_response when createSingleCamTake's data is missing id", async () => {
    const fetch = fetchSequence(CREATE_FILE_OK, PUT_OK, graphqlResponse(200, { data: { createSingleCamTake: {} } }));
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "rejected" } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("fails with invalid_response when createSingleCamJob's data is missing id", async () => {
    const fetch = fetchSequence(
      CREATE_FILE_OK,
      PUT_OK,
      TAKE_OK,
      graphqlResponse(200, { data: { createSingleCamJob: {} } }),
    );
    await expect(
      moveAiSubmitTake({
        apiKey: "sk-test",
        bytes: new Uint8Array([1]),
        mediaType: "video/mp4",
        fetch,
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "rejected" } });
  });
});

describe("moveAiPollJob", () => {
  it("fails before any request when the account has no apiKey stored", async () => {
    const fetch = vi.fn();
    await expect(
      moveAiPollJob({ apiKey: "", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({
      failure: { code: "authentication_failed", requestState: "accepted" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("queries getJob with the exact jobId variable and a raw Authorization header", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, { data: { getJob: { progress: { state: "RUNNING" }, outputs: [] } } }),
    );
    await moveAiPollJob({ apiKey: "sk-poll", state: { jobId: "job_42" }, fetch });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(MOVE_AI_API_URL);
    expect(init!.headers).toEqual({ Authorization: "sk-poll", "content-type": "application/json" });
    const body = bodyJson(init);
    expect(body.query).toContain("getJob(jobId: $jobId)");
    expect(body.query).toContain("$jobId: String!");
    expect(body.variables).toEqual({ jobId: "job_42" });
  });

  it("keeps NOT_STARTED as an accepted poll with the same pollState", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, { data: { getJob: { progress: { state: "NOT_STARTED" }, outputs: [] } } }),
    );
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { jobId: "job_1" },
      retryAfterMs: expect.any(Number),
    });
  });

  it("keeps RUNNING as an accepted poll with the same pollState", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, { data: { getJob: { progress: { state: "RUNNING" }, outputs: [] } } }),
    );
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { jobId: "job_1" },
      retryAfterMs: expect.any(Number),
    });
  });

  it("never leaks the apiKey or any provider secret through an accepted poll result", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, { data: { getJob: { progress: { state: "RUNNING" }, outputs: [] } } }),
    );
    const result = await moveAiPollJob({ apiKey: "sk-super-secret", state: { jobId: "job_1" }, fetch });
    expect(JSON.stringify(result)).not.toContain("sk-super-secret");
    expect(Object.keys((result as { pollState: object }).pollState)).toEqual(["jobId"]);
  });

  it("throws a terminal provider_failed for a FAILED job", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, { data: { getJob: { progress: { state: "FAILED" }, outputs: [] } } }),
    );
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({
      failure: { code: "provider_failed", retryable: false, requestState: "accepted" },
    });
  });

  it("completes a FINISHED job with the MAIN_GLB output pinned to model/gltf-binary", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, {
        data: {
          getJob: {
            progress: { state: "FINISHED", percentageComplete: 100 },
            outputs: [
              { key: "MAIN_GLB", file: { id: "file_out_1", presignedUrl: "https://cdn.move.ai/output/model.glb" } },
            ],
          },
        },
      }),
    );
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).resolves.toEqual({
      status: "completed",
      media: { url: "https://cdn.move.ai/output/model.glb", mediaType: "model/gltf-binary" },
    });
  });

  it("fails with invalid_response when FINISHED has no MAIN_GLB output", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, {
        data: {
          getJob: {
            progress: { state: "FINISHED" },
            outputs: [{ key: "OTHER_OUTPUT", file: { id: "f1", presignedUrl: "https://cdn.move.ai/x" } }],
          },
        },
      }),
    );
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "accepted" } });
  });

  it("fails with invalid_response when FINISHED's MAIN_GLB output has no presignedUrl", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, {
        data: {
          getJob: {
            progress: { state: "FINISHED" },
            outputs: [{ key: "MAIN_GLB", file: { id: "file_out_1" } }],
          },
        },
      }),
    );
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "accepted" } });
  });

  it("fails on an unrecognized job state instead of guessing its meaning", async () => {
    const fetch = fetchSequence(
      graphqlResponse(200, { data: { getJob: { progress: { state: "CANCELLED_BY_USER" }, outputs: [] } } }),
    );
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "accepted" } });
  });

  it("fails with invalid_response on a malformed getJob envelope missing progress", async () => {
    const fetch = fetchSequence(graphqlResponse(200, { data: { getJob: {} } }));
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "accepted" } });
  });

  it("parses GraphQL top-level errors on HTTP 200 as an accepted Provider failure", async () => {
    const fetch = fetchSequence(graphqlResponse(200, { errors: [{ message: "job not found" }] }));
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({ failure: { message: "job not found", requestState: "accepted" } });
  });

  it("converts a non-2xx getJob response into an accepted-request Provider failure", async () => {
    const fetch = fetchSequence(graphqlResponse(404, { errors: [{ message: "not found" }] }, "Not Found"));
    await expect(
      moveAiPollJob({ apiKey: "sk-test", state: { jobId: "job_1" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "task_not_found", requestState: "accepted" } });
  });
});
