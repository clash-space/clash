/**
 * Catalog of well-known ACP agents and a `which`-style detector.
 *
 * The registry is hardcoded on purpose. Users who want to spawn something
 * not on this list go through `AgentSpec` directly — the registry exists
 * to give chat UIs (clash, etc.) a sensible default dropdown without
 * making the user type a binary path.
 *
 * Entries should match what the project actually publishes. Keep the
 * `installHint` so a missing-binary error message can suggest the fix.
 */

import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSpec } from "./types.js";

export interface KnownAgentEntry {
  /** Canonical id used by hosts and dropdowns. Slug-only, no spaces. */
  id: string;
  /** Human-readable name for UI. */
  label: string;
  /** Spec used when this agent is selected. */
  spec: AgentSpec;
  /** Suggested install command, surfaced when detect() returns false. */
  installHint?: string;
  /** Where to learn more / file bugs. */
  homepage?: string;
  probe?: (command: string, options?: ResolveAgentCommandOptions) => Promise<boolean>;
  resolveSpec?: (command: string) => AgentSpec;
}

export const KNOWN_ACP_AGENTS: KnownAgentEntry[] = [
  {
    // Current official build — published by the @agentclientprotocol
    // team, built on Anthropic's Claude Agent SDK. Supersedes the
    // older @zed-industries/claude-code-acp wrapper (which we keep
    // below for back-compat with machines that haven't migrated).
    id: "claude-agent-acp",
    label: "Claude Agent",
    spec: { command: "claude-agent-acp" },
    installHint: "npm install -g @agentclientprotocol/claude-agent-acp",
    homepage: "https://github.com/agentclientprotocol/claude-agent-acp",
  },
  {
    id: "claude-code-acp",
    label: "Claude Code (legacy)",
    spec: { command: "claude-code-acp" },
    installHint: "npm install -g @zed-industries/claude-code-acp  # (legacy; prefer claude-agent-acp)",
    homepage: "https://github.com/zed-industries/claude-code-acp",
  },
  {
    id: "codex-app-server",
    label: "Codex",
    spec: { command: "codex" },
    installHint: "Install the Codex app or expose the codex CLI in your user PATH",
    homepage: "https://developers.openai.com/codex",
    probe: commandOutputIncludes(["app-server", "--help"], "Usage: codex app-server"),
    resolveSpec: (command) => ({
      command: process.execPath,
      args: [codexAppServerAcpEntry(), "--codex", command],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    }),
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    spec: { command: "codex", args: ["--acp"] },
    installHint: "npm install -g @openai/codex",
    homepage: "https://github.com/openai/codex",
    probe: commandHelpIncludes("--acp"),
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    spec: { command: "gemini", args: ["--experimental-acp"] },
    installHint: "npm install -g @google/gemini-cli",
    homepage: "https://github.com/google-gemini/gemini-cli",
  },
  {
    id: "opencode",
    label: "OpenCode",
    spec: { command: "opencode", args: ["acp"] },
    installHint: "https://opencode.ai/docs/ — Go binary, install via the platform package or https://opencode.ai/install.sh",
    homepage: "https://opencode.ai/",
  },
  {
    id: "hermes",
    label: "Hermes (Nous Research)",
    spec: { command: "hermes", args: ["acp"] },
    installHint: "see https://hermes-agent.nousresearch.com/docs/installation/",
    homepage: "https://github.com/NousResearch/hermes-agent",
  },
  {
    // Meta-CLI from openclaw that can wrap many non-native-ACP agents
    // (openclaw, cursor, pi, kiro, qwen). We ship one entry pointing at
    // openclaw because that's the most-asked-for; users can always pass
    // their own AgentSpec to wrap a different one.
    id: "openclaw",
    label: "OpenClaw (via acpx)",
    spec: { command: "acpx", args: ["openclaw"] },
    installHint: "npm install -g acpx",
    homepage: "https://github.com/openclaw/acpx",
  },
];

export interface ResolveAgentCommandOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fromUrl?: string;
}

function commandOutput(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 1500);
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function commandHelpIncludes(needle: string) {
  return async (command: string, options?: ResolveAgentCommandOptions): Promise<boolean> => {
    const output = await commandOutput(command, ["--help"], options?.env);
    return output?.includes(needle) ?? false;
  };
}

function commandOutputIncludes(args: string[], needle: string) {
  return async (command: string, options?: ResolveAgentCommandOptions): Promise<boolean> => {
    const output = await commandOutput(command, args, options?.env);
    return output?.includes(needle) ?? false;
  };
}

function codexAppServerAcpEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = here.endsWith("_acp-runtime") ? dirname(here) : here;
  return join(root, "codex-app-server-acp.js");
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function candidateBinDirs(options: ResolveAgentCommandOptions): string[] {
  const env = options.env ?? process.env;
  const dirs: string[] = [];
  if (env.CLASH_ACP_BIN_DIR) dirs.push(env.CLASH_ACP_BIN_DIR);

  const roots = [
    options.cwd ?? process.cwd(),
    options.fromUrl ? dirname(fileURLToPath(options.fromUrl)) : dirname(fileURLToPath(import.meta.url)),
  ];
  for (const root of roots) {
    let current = root;
    while (true) {
      dirs.push(join(current, "node_modules", ".bin"));
      const parent = dirname(current);
      if (parent === current || current === parse(current).root) break;
      current = parent;
    }
  }

  return [...new Set(dirs)];
}

export async function resolveAgentCommand(
  command: string,
  options: ResolveAgentCommandOptions = {},
): Promise<string | null> {
  for (const dir of candidateBinDirs(options)) {
    const candidate = join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return (await isOnPath(command, options.env)) ? command : null;
}

/**
 * Returns the KnownAgentEntry whose binary is on $PATH, else `null`.
 * Intentionally Node-only — relies on `child_process.spawn`. A web-ui that
 * wants to render a list can call this server-side or in the bridge process.
 */
export async function detect(id: string): Promise<KnownAgentEntry | null> {
  const entry = KNOWN_ACP_AGENTS.find((e) => e.id === id);
  if (!entry) return null;
  const command = await resolveAgentCommand(entry.spec.command);
  if (!command) return null;
  if (entry.probe && !(await entry.probe(command))) return null;
  const spec = entry.resolveSpec
    ? entry.resolveSpec(command)
    : {
        ...entry.spec,
        command,
      };
  return {
    ...entry,
    spec,
  };
}

/** Run `which` (or `where` on Windows). Resolves to true iff exit code 0. */
function isOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = process.platform === "win32" ? "where" : "which";
    const p = spawn(probe, [cmd], { stdio: "ignore", env });
    p.once("error", () => resolve(false));
    p.once("exit", (code) => resolve(code === 0));
  });
}

/** Detect every known agent. Useful for "list available agents" UI. */
export async function detectAll(): Promise<KnownAgentEntry[]> {
  const results = await Promise.all(KNOWN_ACP_AGENTS.map((e) => detect(e.id)));
  return results.filter((e): e is KnownAgentEntry => e !== null);
}
