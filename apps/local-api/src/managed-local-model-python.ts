import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { LocalAsrRuntime, LocalModelStatus, LocalTtsRuntime } from "@clash/sdk";

const execFileAsync = promisify(execFile);
const MANAGED_RUNTIME_SCHEMA_VERSION = 1;
const MANAGED_RUNTIME_RELATIVE_ROOT = join("runtimes", "python", "local-models");
const MANAGED_RUNTIME_STAMP = "runtime.json";

export interface ManagedLocalModelPythonEnvironment {
  readonly pythonBinary: string;
  isReady(): Promise<boolean>;
  ensureReady(): Promise<string>;
}

interface RunCommandOptions {
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
}

type RunCommand = (
  command: string,
  args: string[],
  options: RunCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface ManagedLocalModelPythonEnvironmentOptions {
  clashHome: string;
  sdkPythonPath: string;
  bootstrapPython?: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: RunCommand;
}

interface ManagedRuntimeStamp {
  version: number;
  sdkPythonPath: string;
  createdAt: string;
}

const preparations = new Map<string, Promise<string>>();

function pythonBinaryForVenv(venvDir: string): string {
  return process.platform === "win32"
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(command, args, options);
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

function pythonEnvironment(env: NodeJS.ProcessEnv, sdkPythonPath: string): NodeJS.ProcessEnv {
  return {
    ...env,
    PYTHONPATH: [sdkPythonPath, env.PYTHONPATH]
      .filter(Boolean)
      .join(delimiter),
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INPUT: "1",
  };
}

async function readStamp(path: string): Promise<ManagedRuntimeStamp | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<ManagedRuntimeStamp>;
    if (parsed.version !== MANAGED_RUNTIME_SCHEMA_VERSION) return null;
    if (typeof parsed.sdkPythonPath !== "string" || !parsed.sdkPythonPath) return null;
    if (typeof parsed.createdAt !== "string" || !parsed.createdAt) return null;
    return parsed as ManagedRuntimeStamp;
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function createManagedLocalModelPythonEnvironment(
  options: ManagedLocalModelPythonEnvironmentOptions,
): ManagedLocalModelPythonEnvironment {
  const runtimeRoot = join(options.clashHome, MANAGED_RUNTIME_RELATIVE_ROOT);
  const venvDir = join(runtimeRoot, "venv");
  const pythonBinary = pythonBinaryForVenv(venvDir);
  const stampPath = join(runtimeRoot, MANAGED_RUNTIME_STAMP);
  const bootstrapPython = options.bootstrapPython
    ?? options.env?.CLASH_LOCAL_MODELS_BOOTSTRAP_PYTHON
    ?? process.env.CLASH_LOCAL_MODELS_BOOTSTRAP_PYTHON
    ?? "python3";
  const runCommand = options.runCommand ?? defaultRunCommand;
  const env = pythonEnvironment(options.env ?? process.env, options.sdkPythonPath);
  let verified = false;

  async function verify(python: string): Promise<void> {
    await runCommand(
      python,
      ["-c", "import clash_sdk.local_models.rpc"],
      { env, timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
  }

  async function isReady(): Promise<boolean> {
    if (!(await pathExists(pythonBinary))) return false;
    const stamp = await readStamp(stampPath);
    return stamp?.sdkPythonPath === options.sdkPythonPath;
  }

  async function prepare(): Promise<string> {
    await mkdir(runtimeRoot, { recursive: true });

    if (await pathExists(pythonBinary)) {
      try {
        await verify(pythonBinary);
        verified = true;
      } catch {
        await rm(venvDir, { recursive: true, force: true });
      }
    }

    if (!(await pathExists(pythonBinary))) {
      const stagingDir = join(runtimeRoot, `.venv-${process.pid}-${Date.now()}`);
      try {
        await runCommand(bootstrapPython, ["-m", "venv", stagingDir], {
          env,
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        });
        const stagingPython = pythonBinaryForVenv(stagingDir);
        await verify(stagingPython);
        try {
          await rename(stagingDir, venvDir);
        } catch (error) {
          if (!(await pathExists(pythonBinary))) throw error;
          await verify(pythonBinary);
        }
      } finally {
        await rm(stagingDir, { recursive: true, force: true });
      }
      verified = true;
    }

    const stamp: ManagedRuntimeStamp = {
      version: MANAGED_RUNTIME_SCHEMA_VERSION,
      sdkPythonPath: options.sdkPythonPath,
      createdAt: new Date().toISOString(),
    };
    const temporaryStamp = join(dirname(stampPath), `.${MANAGED_RUNTIME_STAMP}-${process.pid}`);
    await writeFile(temporaryStamp, `${JSON.stringify(stamp, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryStamp, stampPath);
    return pythonBinary;
  }

  return {
    pythonBinary,
    isReady,
    async ensureReady() {
      if (verified && await isReady()) return pythonBinary;
      const existing = preparations.get(runtimeRoot);
      if (existing) return existing;
      const request = prepare()
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Could not prepare Clash-managed Python at ${runtimeRoot}: ${message}. `
            + "Install Python 3.10+ or set CLASH_LOCAL_MODELS_BOOTSTRAP_PYTHON explicitly.",
          );
        })
        .finally(() => {
          if (preparations.get(runtimeRoot) === request) preparations.delete(runtimeRoot);
        });
      preparations.set(runtimeRoot, request);
      return request;
    },
  };
}

function environmentUnavailable(environment: ManagedLocalModelPythonEnvironment): LocalModelStatus {
  return {
    available: false,
    message: `Clash-managed Python is not prepared yet (${environment.pythonBinary}). Deploy the model to prepare it.`,
  };
}

export function withManagedPythonAsrRuntime(
  runtime: LocalAsrRuntime,
  environment: ManagedLocalModelPythonEnvironment,
): LocalAsrRuntime {
  return {
    async status(input) {
      return (await environment.isReady()) ? runtime.status(input) : environmentUnavailable(environment);
    },
    async deploy(input) {
      await environment.ensureReady();
      return runtime.deploy(input);
    },
    async remove(input) {
      if (!(await environment.isReady())) return;
      return runtime.remove?.(input);
    },
    async warmup(input) {
      await environment.ensureReady();
      return runtime.warmup?.(input) ?? runtime.status(input);
    },
    async transcribe(input) {
      await environment.ensureReady();
      return runtime.transcribe(input);
    },
  };
}

export function withManagedPythonTtsRuntime(
  runtime: LocalTtsRuntime,
  environment: ManagedLocalModelPythonEnvironment,
): LocalTtsRuntime {
  return {
    async status(input) {
      return (await environment.isReady()) ? runtime.status(input) : environmentUnavailable(environment);
    },
    async deploy(input) {
      await environment.ensureReady();
      return runtime.deploy(input);
    },
    async remove(input) {
      if (!(await environment.isReady())) return;
      return runtime.remove(input);
    },
    async warmup(input) {
      await environment.ensureReady();
      return runtime.warmup?.(input) ?? runtime.status(input);
    },
    async synthesize(input) {
      await environment.ensureReady();
      return runtime.synthesize(input);
    },
  };
}
