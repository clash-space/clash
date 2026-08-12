import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createManagedLocalModelPythonEnvironment,
  withManagedPythonAsrRuntime,
  withManagedPythonTtsRuntime,
} from "./managed-local-model-python";
import type { LocalAsrRuntime, LocalTtsRuntime } from "@clash/sdk";

let clashHome = "";

beforeEach(async () => {
  clashHome = await mkdtemp(join(tmpdir(), "clash-managed-python-"));
});

afterEach(async () => {
  await rm(clashHome, { recursive: true, force: true });
});

describe("managed local-model Python environment", () => {
  it("creates one Clash-owned venv for concurrent ASR and TTS preparation", async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (args[0] === "-m" && args[1] === "venv") {
        const venvDir = args[2];
        const pythonBinary = join(venvDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
        await mkdir(dirname(pythonBinary), { recursive: true });
        await writeFile(pythonBinary, "fake managed python");
      }
      return { stdout: "", stderr: "" };
    });
    const environment = createManagedLocalModelPythonEnvironment({
      clashHome,
      sdkPythonPath: "/opt/clash-sdk/python",
      bootstrapPython: "/usr/bin/python3",
      runCommand,
    });

    const [first, second] = await Promise.all([
      environment.ensureReady(),
      environment.ensureReady(),
    ]);

    expect(first).toBe(second);
    expect(first).toBe(join(
      clashHome,
      "runtimes",
      "python",
      "local-models",
      "venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ));
    expect(runCommand.mock.calls.filter(([, args]) => args[0] === "-m" && args[1] === "venv")).toHaveLength(1);
    await expect(access(first)).resolves.toBeUndefined();
  });

  it("does not prepare the environment for status, but prepares it once before model operations", async () => {
    let ready = false;
    const environment = {
      pythonBinary: join(clashHome, "runtimes/python/local-models/venv/bin/python"),
      isReady: vi.fn(async () => ready),
      ensureReady: vi.fn(async () => {
        ready = true;
        return join(clashHome, "runtimes/python/local-models/venv/bin/python");
      }),
    };
    const asrDelegate: LocalAsrRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      warmup: vi.fn(async () => ({ available: true })),
      transcribe: vi.fn(async () => ({
        schemaVersion: 1 as const,
        kind: "clash.asr.timed-transcript" as const,
        timebase: "milliseconds" as const,
        alignment: "word" as const,
        text: "hello",
        backendId: "test",
        modelId: "asr-test",
        durationMs: 0,
        words: [],
        segments: [],
      })),
    };
    const ttsDelegate: LocalTtsRuntime = {
      status: vi.fn(async () => ({ available: true })),
      deploy: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      warmup: vi.fn(async () => ({ available: true })),
      synthesize: vi.fn(async ({ outputPath }) => ({
        schemaVersion: 1 as const,
        kind: "clash.tts.audio" as const,
        backendId: "test",
        modelId: "tts-test",
        format: "wav" as const,
        sampleRate: 24_000,
        durationMs: 0,
        outputPath,
      })),
    };
    const asr = withManagedPythonAsrRuntime(asrDelegate, environment);
    const tts = withManagedPythonTtsRuntime(ttsDelegate, environment);

    await expect(asr.status({ model: "asr-test" })).resolves.toMatchObject({ available: false });
    expect(environment.ensureReady).not.toHaveBeenCalled();
    expect(asrDelegate.status).not.toHaveBeenCalled();

    await Promise.all([
      asr.deploy({ model: "asr-test" }),
      tts.deploy({ model: "tts-test" }),
    ]);
    expect(environment.ensureReady).toHaveBeenCalledTimes(2);
    expect(asrDelegate.deploy).toHaveBeenCalledTimes(1);
    expect(ttsDelegate.deploy).toHaveBeenCalledTimes(1);

    await expect(asr.status({ model: "asr-test" })).resolves.toEqual({ available: true });
    expect(asrDelegate.status).toHaveBeenCalledTimes(1);
  });

  it("never silently falls back when the bootstrap interpreter is unavailable", async () => {
    const runCommand = vi.fn(async () => {
      throw new Error("spawn bootstrap ENOENT");
    });
    const environment = createManagedLocalModelPythonEnvironment({
      clashHome,
      sdkPythonPath: "/opt/clash-sdk/python",
      bootstrapPython: "/missing/python3",
      runCommand,
    });

    await expect(environment.ensureReady()).rejects.toThrow(
      /Could not prepare Clash-managed Python.*CLASH_LOCAL_MODELS_BOOTSTRAP_PYTHON/i,
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
