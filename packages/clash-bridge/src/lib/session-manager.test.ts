import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyPermissionModeToAgentSpec,
  composeClashPrompt,
  composeClashPromptContent,
  SessionManager,
  type ManagerOut,
  parseAgentDiagnostic,
  parseAgentDiagnosticStatus,
  selectAcpPermissionOutcome,
} from "./session-manager";

const require = createRequire(import.meta.url);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function writeFakeAcpHarness(binDir: string, captureDir: string): Promise<void> {
  const sdkUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
  const scriptPath = join(binDir, "fake-acp-harness.mjs");
  await writeFile(
    scriptPath,
    [
      "#!/usr/bin/env node",
      "import { writeFile } from 'node:fs/promises';",
      "import { join } from 'node:path';",
      "import { Readable, Writable } from 'node:stream';",
      `import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)};`,
      "",
      "const harnessId = process.env.FAKE_HARNESS_ID || 'unknown';",
      "const captureDir = process.env.CLASH_E2E_PROMPT_CAPTURE_DIR;",
      "const captureJsonDir = process.env.CLASH_E2E_PROMPT_CAPTURE_JSON_DIR;",
      "let currentModeId = 'ask';",
      "",
      "class FakeAcpHarness {",
      "  constructor(connection) { this.connection = connection; }",
      "  async initialize() {",
      "    const promptCapabilities = process.env.FAKE_EMBEDDED_CONTEXT === '1'",
      "      ? { embeddedContext: true }",
      "      : {};",
      "    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { promptCapabilities } };",
      "  }",
      "  async newSession() {",
      "    const modes = process.env.FAKE_SESSION_MODES === '1'",
      "      ? { currentModeId, availableModes: [{ id: 'ask', name: 'Ask' }, { id: 'code', name: 'Code' }] }",
      "      : undefined;",
      "    return { sessionId: `fake-${harnessId}-${Date.now()}`, ...(modes ? { modes } : {}) };",
      "  }",
      "  async setSessionMode(params) {",
      "    currentModeId = params.modeId;",
      "    await this.connection.sessionUpdate({",
      "      sessionId: params.sessionId,",
      "      update: { sessionUpdate: 'current_mode_update', currentModeId },",
      "    });",
      "    return {};",
      "  }",
      "  async authenticate() { return {}; }",
      "  async prompt(params) {",
      "    const prompt = params.prompt.map((part) => part.type === 'text' ? part.text : '').join('');",
      "    if (!captureDir) throw new Error('CLASH_E2E_PROMPT_CAPTURE_DIR missing');",
      "    await writeFile(join(captureDir, `${harnessId}.txt`), prompt, 'utf8');",
      "    if (captureJsonDir) {",
      "      await writeFile(join(captureJsonDir, `${harnessId}.json`), JSON.stringify(params.prompt, null, 2), 'utf8');",
      "    }",
      "    await this.connection.sessionUpdate({",
      "      sessionId: params.sessionId,",
      "      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `ok ${harnessId}` } },",
      "    });",
      "    return { stopReason: 'end_turn' };",
      "  }",
      "  async cancel() {}",
      "}",
      "",
      "const input = Writable.toWeb(process.stdout);",
      "const output = Readable.toWeb(process.stdin);",
      "new AgentSideConnection((connection) => new FakeAcpHarness(connection), ndJsonStream(input, output));",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  for (const binaryName of ["codex-acp", "claude-agent-acp", "gemini", "clash-acp-gemini", "clash-acp-opencode", "hermes", "opencode", "openclaw"]) {
    const geminiHelp = binaryName === "gemini"
      ? [
          "if [ \"${1:-}\" = \"--help\" ]; then",
          "  echo 'Usage: gemini [options]'",
          "  echo '      --experimental-acp          Starts the agent in ACP mode'",
          "  exit 0",
          "fi",
        ]
      : [];
    await writeFile(
      join(binDir, binaryName),
      [
        "#!/bin/sh",
        "set -eu",
        ...geminiHelp,
        `FAKE_HARNESS_ID=${shellQuote(binaryName)} exec ${shellQuote(process.execPath)} ${shellQuote(scriptPath)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  }
}

describe("applyPermissionModeToAgentSpec", () => {
  it("keeps the trusted local permission policy at the Clash host boundary", () => {
    expect(selectAcpPermissionOutcome({
      options: [
        { optionId: "deny", name: "Deny", kind: "reject_once" },
        { optionId: "allow", name: "Allow", kind: "allow_once" },
      ],
    } as never)).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  });

  it("leaves the agent spec unchanged when no permission mode is selected", () => {
    const spec = { command: "codex-acp", args: ["--flag"], env: { KEEP: "1" } };
    expect(applyPermissionModeToAgentSpec(
      "codex-acp",
      spec,
    )).toBe(spec);
  });

  it("does not translate Codex ACP permission to local CLI flags", () => {
    expect(applyPermissionModeToAgentSpec(
      "codex-acp",
      { command: "codex-acp", args: ["-c", "model=gpt-5.5"] },
      "codex:review",
    )).toEqual({
      command: "codex-acp",
      args: ["-c", "model=gpt-5.5"],
      env: { CLASH_PERMISSION_MODE: "codex:review" },
    });
  });

  it("preserves existing harness env while forwarding the selected permission mode", () => {
    expect(applyPermissionModeToAgentSpec(
      "codex-acp",
      { command: "codex-acp", env: { EXISTING: "yes" } },
      "codex:full-access",
    )).toEqual({
      command: "codex-acp",
      env: {
        EXISTING: "yes",
        CLASH_PERMISSION_MODE: "codex:full-access",
      },
    });
  });

  it("leaves non-Codex harness arguments untouched and forwards the harness mode", () => {
    expect(applyPermissionModeToAgentSpec(
      "claude-acp",
      { command: "claude-agent-acp" },
      "claude:full-access",
    )).toEqual({
      command: "claude-agent-acp",
      env: { CLASH_PERMISSION_MODE: "claude:full-access" },
    });
  });
});

describe("composeClashPrompt", () => {
  it("prepends the project AGENTS.md contract and runtime context to every prompt", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clash-prompt-cwd-"));
    await writeFile(
      join(cwd, "AGENTS.md"),
      [
        "# Clash agent operating rules",
        "",
        "You are a Clash project agent, not a generic coding assistant.",
        "Use `clash project status --json` and `clash canvas list --json` from this cwd.",
      ].join("\n"),
      "utf-8",
    );

    const prompt = await composeClashPrompt("你是谁？", {
      cwd,
      env: {
        CLASH_PROJECT_ID: "project-contract",
        CLASH_AGENT_MEMBER_ID: "local-master-clash",
        CLASH_PERMISSION_MODE: "codex:full-access",
      },
    });

    expect(prompt).toContain("# Clash agent contract (read first)");
    expect(prompt).toContain("# Clash agent operating rules");
    expect(prompt).toContain("not a generic coding assistant");
    expect(prompt).toContain(`- cwd: ${cwd}`);
    expect(prompt).toContain("- CLASH_PROJECT_ID=project-contract");
    expect(prompt).toContain("- CLASH_AGENT_MEMBER_ID=local-master-clash");
    expect(prompt).toContain("- CLASH_PERMISSION_MODE=codex:full-access");
    expect(prompt).toContain("# User request\n\n你是谁？");
  });

  it("falls back to standard clash init guidance when AGENTS.md is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clash-prompt-empty-cwd-"));

    const prompt = await composeClashPrompt("开始", {
      cwd,
      env: { CLASH_PROJECT_ID: "project-missing-contract" },
    });

    expect(prompt).toContain("No AGENTS.md was found in cwd");
    expect(prompt).toContain("clash init --project \"$CLASH_PROJECT_ID\" --json");
    expect(prompt).toContain("- CLASH_PROJECT_ID=project-missing-contract");
  });

  it("can attach AGENTS.md as an ACP embedded resource when the harness supports embedded context", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "clash-prompt-resource-cwd-"));
    await writeFile(
      join(cwd, "AGENTS.md"),
      [
        "# Master Clash",
        "",
        "Always use the Clash CLI before guessing project state.",
      ].join("\n"),
      "utf-8",
    );

    const blocks = await composeClashPromptContent("开始", {
      cwd,
      env: {
        CLASH_PROJECT_ID: "project-resource-contract",
        CLASH_AGENT_MEMBER_ID: "local-master-clash",
      },
    }, { embeddedContext: true });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "resource",
      resource: {
        uri: pathToFileURL(join(cwd, "AGENTS.md")).href,
        mimeType: "text/markdown",
        text: expect.stringContaining("Always use the Clash CLI"),
      },
      _meta: {
        "clash.kind": "agent_contract",
      },
    });
    expect(blocks[1]).toMatchObject({
      type: "text",
      text: expect.stringContaining("# Clash agent contract (read first)"),
    });
  });
});

describe("SessionManager harness prompt contract", () => {
  it("starts registry-only agents from the supplied agent spec", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-dynamic-agent-spec-"));
    const binDir = join(root, "bin");
    const captureDir = join(root, "captures");
    const home = join(root, "home");
    await mkdir(binDir, { recursive: true });
    await mkdir(captureDir, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFakeAcpHarness(binDir, captureDir);

    const previousEnv = {
      CLASH_ACP_BIN_DIR: process.env.CLASH_ACP_BIN_DIR,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    };
    process.env.CLASH_ACP_BIN_DIR = "";
    process.env.PATH = "";
    process.env.HOME = home;

    try {
      const sent: ManagerOut[] = [];
      const manager = new SessionManager((msg) => sent.push(msg));
      manager.setSpawnEnv({ CLASH_E2E_PROMPT_CAPTURE_DIR: captureDir });

      await manager.start({
        session_id: "session-dynamic-devin",
        agent_template_id: "master-clash",
        agent_id: "registry-only-devin",
        agent_spec: { command: join(binDir, "codex-acp") },
        project_id: "project-dynamic-devin",
      });
      await manager.dispose("session-dynamic-devin");

      expect(sent.some((msg) => msg.type === "session.ready")).toBe(true);
      expect(sent.some((msg) => msg.type === "session.error")).toBe(false);
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("forwards ACP session modes and mode changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-session-modes-"));
    const binDir = join(root, "bin");
    const captureDir = join(root, "captures");
    const home = join(root, "home");
    await mkdir(binDir, { recursive: true });
    await mkdir(captureDir, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFakeAcpHarness(binDir, captureDir);

    const previousEnv = {
      CLASH_ACP_BIN_DIR: process.env.CLASH_ACP_BIN_DIR,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    };
    process.env.CLASH_ACP_BIN_DIR = "";
    process.env.PATH = "";
    process.env.HOME = home;

    try {
      const sent: ManagerOut[] = [];
      const manager = new SessionManager((msg) => sent.push(msg));
      manager.setSpawnEnv({
        CLASH_E2E_PROMPT_CAPTURE_DIR: captureDir,
        FAKE_SESSION_MODES: "1",
      });

      await manager.start({
        session_id: "session-modes",
        agent_template_id: "master-clash",
        agent_id: "registry-only-codex",
        agent_spec: { command: join(binDir, "codex-acp") },
        project_id: "project-session-modes",
      });

      expect(sent.find((msg) => msg.type === "session.ready")).toMatchObject({
        type: "session.ready",
        session_id: "session-modes",
        modes: {
          currentModeId: "ask",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" },
          ],
        },
      });

      await manager.setMode("session-modes", "code");
      expect([...sent].reverse().find((msg) => msg.type === "session.mode")).toEqual({
        type: "session.mode",
        session_id: "session-modes",
        modes: {
          currentModeId: "code",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" },
          ],
        },
      });
      await manager.dispose("session-modes");
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("injects the Clash contract before prompts for every registry harness", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-harness-contract-"));
    const binDir = join(root, "bin");
    const captureDir = join(root, "captures");
    const home = join(root, "home");
    await mkdir(binDir, { recursive: true });
    await mkdir(captureDir, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFakeAcpHarness(binDir, captureDir);

    const previousEnv = {
      CLASH_ACP_BIN_DIR: process.env.CLASH_ACP_BIN_DIR,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    };
    process.env.CLASH_ACP_BIN_DIR = binDir;
    process.env.PATH = [binDir, previousEnv.PATH ?? ""].filter(Boolean).join(delimiter);
    process.env.HOME = home;

    try {
      const harnesses = [
        ["codex-acp", "codex-acp"],
        ["claude-acp", "claude-agent-acp"],
        ["gemini", "clash-acp-gemini"],
        ["hermes", "hermes"],
        ["opencode", "clash-acp-opencode"],
        ["openclaw", "openclaw"],
      ] as const;

      for (const [agentId, binaryName] of harnesses) {
        const sent: ManagerOut[] = [];
        const manager = new SessionManager((msg) => sent.push(msg));
        manager.setSpawnEnv({ CLASH_E2E_PROMPT_CAPTURE_DIR: captureDir });
        const sessionId = `session-${agentId}`;
        const projectId = `project-${agentId}`;

        await manager.start({
          session_id: sessionId,
          agent_template_id: "master-clash",
          agent_id: agentId,
          agent_member_id: "local-master-clash",
          project_id: projectId,
          permission_mode: `${agentId}:full-access`,
        });
        expect(sent.some((msg) => msg.type === "session.ready")).toBe(true);

        await manager.prompt({
          session_id: sessionId,
          turn_id: `turn-${agentId}`,
          text: `identify ${agentId}`,
        });
        await manager.dispose(sessionId);

        expect(sent.some((msg) => msg.type === "session.complete" && msg.turn_id === `turn-${agentId}`)).toBe(true);
        const prompt = await readFile(join(captureDir, `${binaryName}.txt`), "utf-8");
        expect(prompt).toContain("# Clash agent contract (read first)");
        expect(prompt).toContain("Master Clash");
        expect(prompt).toContain(`# User request\n\nidentify ${agentId}`);
        expect(prompt).toContain(`- CLASH_PROJECT_ID=${projectId}`);
        expect(prompt).toContain("- CLASH_AGENT_MEMBER_ID=local-master-clash");
        expect(prompt).toContain(`- CLASH_PERMISSION_MODE=${agentId}:full-access`);
        expect(prompt).not.toContain("No AGENTS.md was found");
      }
    } finally {
      restoreEnv(previousEnv);
    }
  }, 10_000);

  it("uses ACP embedded context for AGENTS.md when the harness advertises support", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-harness-resource-"));
    const binDir = join(root, "bin");
    const captureDir = join(root, "captures");
    const captureJsonDir = join(root, "capture-json");
    const home = join(root, "home");
    await mkdir(binDir, { recursive: true });
    await mkdir(captureDir, { recursive: true });
    await mkdir(captureJsonDir, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFakeAcpHarness(binDir, captureDir);

    const previousEnv = {
      CLASH_ACP_BIN_DIR: process.env.CLASH_ACP_BIN_DIR,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    };
    process.env.CLASH_ACP_BIN_DIR = binDir;
    process.env.PATH = [binDir, previousEnv.PATH ?? ""].filter(Boolean).join(delimiter);
    process.env.HOME = home;

    try {
      const sent: ManagerOut[] = [];
      const manager = new SessionManager((msg) => sent.push(msg));
      manager.setSpawnEnv({
        CLASH_E2E_PROMPT_CAPTURE_DIR: captureDir,
        CLASH_E2E_PROMPT_CAPTURE_JSON_DIR: captureJsonDir,
        FAKE_EMBEDDED_CONTEXT: "1",
      });
      await manager.start({
        session_id: "session-embedded-context",
        agent_template_id: "master-clash",
        agent_id: "codex-acp",
        agent_member_id: "local-master-clash",
        project_id: "project-embedded-context",
      });
      await manager.prompt({
        session_id: "session-embedded-context",
        turn_id: "turn-embedded-context",
        text: "read contract",
      });
      await manager.dispose("session-embedded-context");

      expect(sent.some((msg) => msg.type === "session.complete" && msg.turn_id === "turn-embedded-context")).toBe(true);
      const promptBlocks = JSON.parse(await readFile(join(captureJsonDir, "codex-acp.json"), "utf-8"));
      expect(promptBlocks[0]).toMatchObject({
        type: "resource",
        resource: {
          mimeType: "text/markdown",
          text: expect.stringContaining("Master Clash"),
        },
        _meta: {
          "clash.kind": "agent_contract",
        },
      });
      expect(promptBlocks[1]).toMatchObject({
        type: "text",
        text: expect.stringContaining("# User request\n\nread contract"),
      });
    } finally {
      restoreEnv(previousEnv);
    }
  });
});

describe("parseAgentDiagnosticStatus", () => {
  it("maps Codex sampling retries to a transient reconnecting status", () => {
    expect(parseAgentDiagnosticStatus(
      "2026-06-20T01:15:04.123Z WARN codex_core::responses_retry: stream disconnected - retrying sampling request (3/5 in 2.0s)...",
    )).toEqual({
      status: "reconnecting",
      attempt: 3,
      maxAttempts: 5,
      message: "Reconnecting... 3/5",
      detail: "stream disconnected",
    });
  });

  it("maps Codex HTTP fallback diagnostics without treating them as assistant text", () => {
    expect(parseAgentDiagnosticStatus(
      "Handled error during turn: Falling back from WebSockets to HTTPS transport. request timed out",
    )).toEqual({
      status: "transport_fallback",
      message: "Switching transport",
      detail: "request timed out",
    });
  });
});

describe("parseAgentDiagnostic", () => {
  it("keeps arbitrary stderr diagnostics as structured debug data", () => {
    expect(parseAgentDiagnostic("2026-06-20T01:20:00.000Z WARN provider cache warmup took 3020ms")).toEqual({
      stream: "stderr",
      severity: "warning",
      raw: "2026-06-20T01:20:00.000Z WARN provider cache warmup took 3020ms",
      message: "provider cache warmup took 3020ms",
    });
  });

  it("attaches a transient status when stderr carries retry semantics", () => {
    expect(parseAgentDiagnostic("WARN stream disconnected - retrying sampling request (4/5 in 4.0s)...")).toEqual({
      stream: "stderr",
      severity: "warning",
      raw: "WARN stream disconnected - retrying sampling request (4/5 in 4.0s)...",
      message: "Reconnecting... 4/5",
      transientStatus: {
        status: "reconnecting",
        attempt: 4,
        maxAttempts: 5,
        message: "Reconnecting... 4/5",
        detail: "stream disconnected",
      },
    });
  });
});
