import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
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
  return async (args, cwd) => {
    const host = await hostManager.ensureHost();
    const command = host.agentCliPath;
    const workingDirectory = cwd?.trim()
      ? isAbsolute(cwd) ? cwd : resolve(cwd)
      : isAbsolute(sessionWorkspace) ? sessionWorkspace : resolve(sessionWorkspace);
    const { stdout } = await execFileAsync(command, args, {
      cwd: workingDirectory,
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseOutput(stdout);
  };
}
