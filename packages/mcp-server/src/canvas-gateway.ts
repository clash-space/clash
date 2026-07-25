import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildCanvasCliArgs,
  type CanvasMcpToolName,
  type CanvasToolInput,
} from "./canvas-contract";

const execFileAsync = promisify(execFile);

export type CanvasCliRunner = (args: string[], cwd?: string) => Promise<unknown>;

export function createClashCliRunner(options: {
  command?: string;
  argsPrefix?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): CanvasCliRunner {
  const command = options.command ?? process.env.CLASH_CLI_BIN ?? "clash";
  const argsPrefix = options.argsPrefix ?? [];
  return async (args, cwd) => {
    const { stdout } = await execFileAsync(command, [...argsPrefix, ...args], {
      cwd: cwd ?? options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    const text = stdout.trim();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { stdout: text };
    }
  };
}

export async function invokeCanvasTool(
  name: CanvasMcpToolName,
  input: CanvasToolInput,
  runner: CanvasCliRunner,
): Promise<unknown> {
  if (name === "clash_canvas_open" || name === "clash_canvas_snapshot") {
    const scope = { projectId: input.projectId, canvasId: input.canvasId };
    const [nodes, edges] = await Promise.all([
      runner(buildCanvasCliArgs("clash_canvas_list", scope), input.cwd),
      runner(buildCanvasCliArgs("clash_canvas_edges", scope), input.cwd),
    ]);
    return {
      projectId: input.projectId,
      canvasId: input.canvasId ?? "main",
      nodes: Array.isArray(nodes) ? nodes : [],
      edges: Array.isArray(edges) ? edges : [],
    };
  }
  return runner(buildCanvasCliArgs(name, input), input.cwd);
}
