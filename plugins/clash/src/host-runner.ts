import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createPluginHostManager,
  type PluginHostManager,
} from "./plugin-host.js";

const execFileAsync = promisify(execFile);

export type HostCliRunner = (args: string[], cwd?: string) => Promise<unknown>;

function parseOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { stdout: text };
  }
}

export function createHostCliRunner(options: {
  runDir?: string;
  env?: NodeJS.ProcessEnv;
  command?: string;
  bundledCliPath?: string;
  hostManager?: Pick<PluginHostManager, "ensureHost">;
} = {}): HostCliRunner {
  const env = options.env ?? process.env;
  const hostManager = options.hostManager ?? createPluginHostManager({
    runDir: options.runDir,
    env,
  });
  const sessionWorkspace =
    env.CLASH_WORKSPACE_ROOT?.trim() ||
    env.CODEX_WORKSPACE_ROOT?.trim() ||
    process.cwd();
  const configuredCommand =
    options.command?.trim() || env.CLASH_CLI_ENTRY_PATH?.trim();
  const bundledCliPath =
    options.bundledCliPath ??
    fileURLToPath(new URL("./clash-cli.cjs", import.meta.url));
  const command = configuredCommand || process.execPath;
  const argsPrefix = configuredCommand ? [] : [bundledCliPath];
  return async (args, cwd) => {
    const explicitApiUrl = env.CLASH_API_URL?.trim();
    const host = explicitApiUrl ? undefined : await hostManager.ensureHost();
    const workingDirectory = cwd?.trim()
      ? isAbsolute(cwd) ? cwd : resolve(cwd)
      : isAbsolute(sessionWorkspace) ? sessionWorkspace : resolve(sessionWorkspace);
    const { stdout } = await execFileAsync(command, [...argsPrefix, ...args], {
      cwd: workingDirectory,
      env: {
        ...env,
        ...(host ? { CLASH_API_URL: host.endpoint } : {}),
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseOutput(stdout);
  };
}
