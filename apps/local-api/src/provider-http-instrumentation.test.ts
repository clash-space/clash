import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startProviderHttpInstrumentation } from "./provider-http-instrumentation.js";
import * as actionsLoader from "./runtime/host/lib/actions-loader.js";
import {
  providerHttpInstrumentationEnvironment,
  providerHttpInstrumentationNodeArgs,
} from "./runtime/host/lib/actions-loader.js";
import {
  createProviderConformanceStubs,
  createProviderTestReplayFetch,
  createProviderTestReplayFixtures,
  providerTestRecordingEventToJsonl,
  readJsonlProviderTestRecording,
} from "./provider-test-recorder.js";

const disposals: Array<() => void> = [];
const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const dispose of disposals.splice(0)) dispose();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function stub() {
  const value = createProviderConformanceStubs({ includeMock: true }).find(
    (candidate) =>
      candidate.providerId === "mock" && candidate.shape === "text",
  );
  if (!value) throw new Error("Mock text provider stub is missing.");
  return value;
}

describe("provider process HTTP instrumentation", () => {
  it("records ordinary plugin fetch without entering the plugin context", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-provider-http-record-"));
    roots.push(root);
    const trafficPath = join(root, "traffic.jsonl");
    const activeStubPath = join(root, "active-stub.json");
    await writeFile(activeStubPath, JSON.stringify(stub()), "utf8");
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ answer: "recorded" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind.");

    const instrumentation = await startProviderHttpInstrumentation({
      mode: "record",
      trafficPath,
      activeStubPath,
      includeLoopback: true,
    });
    disposals.push(() => instrumentation.dispose());
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/generate`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer must-not-land",
            "content-type": "application/json",
          },
          body: JSON.stringify({ prompt: "ordinary fetch" }),
        },
      );
      await expect(response.json()).resolves.toEqual({ answer: "recorded" });
      await vi.waitFor(async () => {
        expect(
          (await readFile(trafficPath, "utf8")).trim().split(/\r?\n/),
        ).toHaveLength(2);
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const events = await readJsonlProviderTestRecording(trafficPath);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "request",
      request: {
        method: "POST",
        headers: { authorization: "[redacted]" },
        body: { prompt: "ordinary fetch" },
      },
    });
    expect(JSON.stringify(events)).not.toContain("must-not-land");
  });

  it("records fetch-decoded bodies instead of gzip, deflate, or br wire bytes", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "clash-provider-http-compressed-"),
    );
    roots.push(root);
    const trafficPath = join(root, "traffic.jsonl");
    const activeStubPath = join(root, "active-stub.json");
    await writeFile(activeStubPath, JSON.stringify(stub()), "utf8");
    const compressors = {
      gzip: gzipSync,
      deflate: deflateSync,
      br: brotliCompressSync,
    } as const;
    const server = createServer((request, response) => {
      const encoding = request.url?.slice(1) as keyof typeof compressors;
      const body = Buffer.from(
        JSON.stringify({ answer: `decoded-${encoding}` }),
      );
      response.setHeader("content-type", "application/json");
      response.setHeader("content-encoding", encoding);
      response.setHeader(
        "content-length",
        String(compressors[encoding](body).byteLength),
      );
      response.end(compressors[encoding](body));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind.");

    const instrumentation = await startProviderHttpInstrumentation({
      mode: "record",
      trafficPath,
      activeStubPath,
      includeLoopback: true,
    });
    disposals.push(() => instrumentation.dispose());
    try {
      for (const encoding of Object.keys(compressors)) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/${encoding}`,
        );
        await expect(response.json()).resolves.toEqual({
          answer: `decoded-${encoding}`,
        });
      }
      await vi.waitFor(async () => {
        expect(
          (await readFile(trafficPath, "utf8")).trim().split(/\r?\n/),
        ).toHaveLength(6);
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const events = await readJsonlProviderTestRecording(trafficPath);
    const responses = events.filter((event) => event.type === "response");
    expect(responses.map((event) => event.response.body)).toEqual([
      { answer: "decoded-gzip" },
      { answer: "decoded-deflate" },
      { answer: "decoded-br" },
    ]);
    for (const event of responses) {
      expect(event.response.headers).not.toHaveProperty("content-encoding");
      expect(event.response.headers).not.toHaveProperty("content-length");
      expect(event.response.headers).not.toHaveProperty("transfer-encoding");
    }

    const replayFetch = createProviderTestReplayFetch(
      createProviderTestReplayFixtures(events),
    );
    for (const encoding of Object.keys(compressors)) {
      const response = await replayFetch(
        `http://127.0.0.1:${address.port}/${encoding}`,
      );
      await expect(response.json()).resolves.toEqual({
        answer: `decoded-${encoding}`,
      });
    }
  });

  it("replays a cassette before any real socket is opened", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-provider-http-replay-"));
    roots.push(root);
    const trafficPath = join(root, "traffic.jsonl");
    const requestId = "provider-replay-1";
    await writeFile(
      trafficPath,
      [
        providerTestRecordingEventToJsonl({
          schemaVersion: 1,
          type: "request",
          timestamp: "2026-08-12T00:00:00.000Z",
          requestId,
          stub: stub(),
          request: {
            url: "https://provider.invalid/generate",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: { prompt: "replay me" },
          },
        }),
        providerTestRecordingEventToJsonl({
          schemaVersion: 1,
          type: "response",
          timestamp: "2026-08-12T00:00:01.000Z",
          requestId,
          response: {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
              "content-length": "17",
              "transfer-encoding": "chunked",
            },
            body: { answer: "from cassette" },
          },
        }),
      ].join(""),
      "utf8",
    );

    const instrumentation = await startProviderHttpInstrumentation({
      mode: "replay",
      trafficPath,
    });
    disposals.push(() => instrumentation.dispose());
    const response = await fetch("https://provider.invalid/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "replay me" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ answer: "from cassette" });
  });

  it("preloads replay outside a Node plugin before its entrypoint runs", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "clash-provider-http-child-replay-"),
    );
    roots.push(root);
    const trafficPath = join(root, "traffic.jsonl");
    const entrypointPath = join(root, "plugin.mjs");
    const requestId = "provider-child-replay-1";
    await writeFile(
      trafficPath,
      [
        providerTestRecordingEventToJsonl({
          schemaVersion: 1,
          type: "request",
          timestamp: "2026-08-12T00:00:00.000Z",
          requestId,
          stub: stub(),
          request: {
            url: "https://provider-child.invalid/generate",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: { prompt: "child replay" },
          },
        }),
        providerTestRecordingEventToJsonl({
          schemaVersion: 1,
          type: "response",
          timestamp: "2026-08-12T00:00:01.000Z",
          requestId,
          response: {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
            },
            body: { answer: "preloaded" },
          },
        }),
      ].join(""),
      "utf8",
    );
    await writeFile(
      entrypointPath,
      [
        "const response = await fetch('https://provider-child.invalid/generate', {",
        "  method: 'POST',",
        "  headers: { 'content-type': 'application/json' },",
        "  body: JSON.stringify({ prompt: 'child replay' }),",
        "});",
        "process.stdout.write(JSON.stringify(await response.json()));",
      ].join("\n"),
      "utf8",
    );

    const launch = {
      mode: "replay" as const,
      trafficPath,
      modulePath: fileURLToPath(
        new URL("./provider-http-instrumentation.ts", import.meta.url),
      ),
      loaderPath: createRequire(import.meta.url).resolve("tsx"),
    };
    const { stdout } = await execFileAsync(
      process.execPath,
      [...providerHttpInstrumentationNodeArgs(launch), entrypointPath],
      {
        env: {
          PATH: process.env.PATH,
          ...providerHttpInstrumentationEnvironment(launch),
        },
        timeout: 60_000,
      },
    );

    expect(JSON.parse(stdout)).toEqual({ answer: "preloaded" });
  });

  it("records and replays supported Python HTTP clients without network fallback", async () => {
    const pythonEnvironment = (actionsLoader as Record<string, unknown>)
      .providerHttpInstrumentationPythonEnvironment as
      | ((
          launch: Record<string, unknown>,
          inherited?: NodeJS.ProcessEnv,
        ) => NodeJS.ProcessEnv)
      | undefined;
    expect(pythonEnvironment).toBeTypeOf("function");
    if (!pythonEnvironment) return;

    const root = await mkdtemp(join(tmpdir(), "clash-provider-http-python-"));
    roots.push(root);
    const activeStubPath = join(root, "active-stub.json");
    await writeFile(activeStubPath, JSON.stringify(stub()), "utf8");
    const optionalModules = JSON.parse(
      (
        await execFileAsync("python3", [
          "-c",
          [
            "import importlib.util, json",
            "print(json.dumps({name: importlib.util.find_spec(name) is not None for name in ('requests', 'httpx', 'aiohttp')}))",
          ].join("\n"),
        ])
      ).stdout,
    ) as Record<string, boolean>;
    const clients = [
      {
        id: "urllib",
        pythonArgs: ["-B", "-s"],
        source: [
          "import os, urllib.request",
          "request = urllib.request.Request(os.environ['TEST_URL'], data=b'{\"prompt\":\"ordinary python\"}', headers={'content-type': 'application/json', 'authorization': 'Bearer python-secret'}, method='POST')",
          "with urllib.request.urlopen(request) as response:",
          "    print(response.read().decode('utf-8'))",
        ].join("\n"),
      },
      {
        id: "requests",
        module: "requests",
        pythonArgs: ["-B"],
        source: [
          "import os, requests",
          "response = requests.post(os.environ['TEST_URL'], json={'prompt': 'ordinary python'}, headers={'authorization': 'Bearer python-secret'})",
          "print(response.text)",
        ].join("\n"),
      },
      {
        id: "requests-multipart",
        module: "requests",
        pythonArgs: ["-B"],
        source: [
          "import os, requests",
          "response = requests.post(os.environ['TEST_URL'], data={'purpose': 'provider_input'}, files={'file': ('reference.bin', bytes([0, 1, 2, 3]), 'application/octet-stream')}, headers={'authorization': 'Bearer python-secret'})",
          "print(response.text)",
        ].join("\n"),
      },
      {
        id: "httpx",
        module: "httpx",
        pythonArgs: ["-B"],
        source: [
          "import os, httpx",
          "with httpx.Client() as client:",
          "    response = client.post(os.environ['TEST_URL'], json={'prompt': 'ordinary python'}, headers={'authorization': 'Bearer python-secret'})",
          "    print(response.text)",
        ].join("\n"),
      },
      {
        id: "httpx-async",
        module: "httpx",
        pythonArgs: ["-B"],
        source: [
          "import asyncio, os, httpx",
          "async def main():",
          "    async with httpx.AsyncClient() as client:",
          "        response = await client.post(os.environ['TEST_URL'], json={'prompt': 'ordinary python'}, headers={'authorization': 'Bearer python-secret'})",
          "        print(response.text)",
          "asyncio.run(main())",
        ].join("\n"),
      },
      {
        id: "aiohttp",
        module: "aiohttp",
        pythonArgs: ["-B"],
        source: [
          "import asyncio, os, aiohttp",
          "async def main():",
          "    async with aiohttp.ClientSession() as client:",
          "        async with client.post(os.environ['TEST_URL'], json={'prompt': 'ordinary python'}, headers={'authorization': 'Bearer python-secret'}) as response:",
          "            print(await response.text())",
          "asyncio.run(main())",
        ].join("\n"),
      },
    ].filter(
      (client) =>
        client.id === "urllib" ||
        ("module" in client &&
          typeof client.module === "string" &&
          optionalModules[client.module] === true),
    );
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ answer: `recorded-${request.url?.slice(1)}` }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind.");
    }

    const recordings: Array<{
      id: string;
      source: string;
      pythonArgs: readonly string[];
      trafficPath: string;
      url: string;
    }> = [];
    try {
      for (const client of clients) {
        const trafficPath = join(root, `${client.id}.jsonl`);
        const url = `http://127.0.0.1:${address.port}/${client.id}`;
        const launch = {
          mode: "record",
          trafficPath,
          activeStubPath,
          modulePath: fileURLToPath(
            new URL("./provider-http-instrumentation.ts", import.meta.url),
          ),
        };
        const { stdout } = await execFileAsync(
          "python3",
          [...client.pythonArgs, "-c", client.source],
          {
            env: {
              ...process.env,
              ...pythonEnvironment(launch, process.env),
              TEST_URL: url,
            },
            timeout: 60_000,
          },
        );
        expect(JSON.parse(stdout)).toEqual({
          answer: `recorded-${client.id}`,
        });
        recordings.push({ ...client, trafficPath, url });
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    for (const recording of recordings) {
      const raw = await readFile(recording.trafficPath, "utf8");
      const events = await readJsonlProviderTestRecording(
        recording.trafficPath,
      );
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "request",
        request: {
          method: "POST",
          headers: { authorization: "[redacted]" },
          body:
            recording.id === "requests-multipart"
              ? {
                  $multipart: [
                    { name: "purpose", value: "provider_input" },
                    {
                      name: "file",
                      file: {
                        name: "reference.bin",
                        type: "application/octet-stream",
                        byteLength: 4,
                        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
                      },
                    },
                  ],
                }
              : { prompt: "ordinary python" },
        },
      });
      expect(events[1]).toMatchObject({
        type: "response",
        response: {
          status: 200,
          body: { answer: `recorded-${recording.id}` },
        },
      });
      expect(raw).not.toContain("python-secret");

      const replayLaunch = {
        mode: "replay",
        trafficPath: recording.trafficPath,
        modulePath: fileURLToPath(
          new URL("./provider-http-instrumentation.ts", import.meta.url),
        ),
      };
      const replayEnv = {
        ...process.env,
        ...pythonEnvironment(replayLaunch, process.env),
      };
      const { stdout } = await execFileAsync(
        "python3",
        [...recording.pythonArgs, "-c", recording.source],
        {
          env: { ...replayEnv, TEST_URL: recording.url },
          timeout: 60_000,
        },
      );
      expect(JSON.parse(stdout)).toEqual({
        answer: `recorded-${recording.id}`,
      });

      await expect(
        execFileAsync(
          "python3",
          [...recording.pythonArgs, "-c", recording.source],
          {
            env: { ...replayEnv, TEST_URL: `${recording.url}/miss` },
            timeout: 60_000,
          },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("No provider test replay fixture"),
      });
    }
  }, 5 * 60_000);
});
