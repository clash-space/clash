import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { parseCodexAppServerOutput, runCodexDebug } from "./codex-app-server-acp";

const require = createRequire(import.meta.url);
const tsxLoader = (() => {
  try {
    return require.resolve("tsx");
  } catch {
    return createRequire(new URL("../../cli/package.json", import.meta.url)).resolve("tsx");
  }
})();

async function waitForCondition(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Codex app-server ACP adapter", () => {
  it("maps Codex app-server item events to ACP tool and message updates", () => {
    const output = [
      '< {',
      '<   "jsonrpc": "2.0",',
      '<   "method": "item/started",',
      '<   "params": {',
      '<     "item": {',
      '<       "type": "commandExecution",',
      '<       "id": "call_pwd",',
      '<       "command": "/bin/zsh -lc pwd",',
      '<       "cwd": "/tmp/project",',
      '<       "status": "inProgress"',
      '<     }',
      '<   }',
      '< }',
      '< {',
      '<   "jsonrpc": "2.0",',
      '<   "method": "item/completed",',
      '<   "params": {',
      '<     "item": {',
      '<       "type": "commandExecution",',
      '<       "id": "call_pwd",',
      '<       "command": "/bin/zsh -lc pwd",',
      '<       "cwd": "/tmp/project",',
      '<       "status": "completed",',
      '<       "aggregatedOutput": "/tmp/project\\n",',
      '<       "exitCode": 0,',
      '<       "durationMs": 12',
      '<     }',
      '<   }',
      '< }',
      '< {',
      '<   "jsonrpc": "2.0",',
      '<   "method": "item/completed",',
      '<   "params": {',
      '<     "item": {',
      '<       "type": "agentMessage",',
      '<       "id": "msg_1",',
      '<       "text": "/tmp/project",',
      '<       "phase": "final_answer"',
      '<     }',
      '<   }',
      '< }',
    ].join("\n");

    expect(parseCodexAppServerOutput(output)).toEqual({
      finalText: "/tmp/project",
      events: [
        {
          sessionUpdate: "tool_call",
          toolCallId: "call_pwd",
          title: "/bin/zsh -lc pwd",
          kind: "execute",
          status: "in_progress",
          rawInput: { command: "/bin/zsh -lc pwd", cwd: "/tmp/project" },
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_pwd",
          title: "/bin/zsh -lc pwd",
          kind: "execute",
          status: "completed",
          rawInput: { command: "/bin/zsh -lc pwd", cwd: "/tmp/project" },
          rawOutput: "/tmp/project\n",
        },
        {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_1",
          content: { type: "text", text: "/tmp/project" },
        },
      ],
    });
  });

  it("passes the selected Codex permission mode as native Codex flags", async () => {
    const binDir = join(tmpdir(), `clash-fake-codex-permission-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const fakeCodex = join(binDir, "codex");
    const argvPath = join(binDir, "argv.txt");
    await writeFile(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
console.log('< item completed: AgentMessage { id: "msg_1", text: "ok", phase: Some(FinalAnswer), memory_citation: None }');
`,
      { mode: 0o755 },
    );

    await expect(runCodexDebug({
      codexCommand: fakeCodex,
      cwd: binDir,
      prompt: "hello",
      env: { CLASH_PERMISSION_MODE: "codex:full-access" },
    })).resolves.toBe("ok");

    const argv = JSON.parse(await readFile(argvPath, "utf8")) as string[];
    expect(argv).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "debug",
      "app-server",
      "send-message-v2",
      "hello",
    ]);
  });

  it("exposes Codex permission modes through ACP session modes", async () => {
    const binDir = join(tmpdir(), `clash-fake-codex-config-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const fakeCodex = join(binDir, "codex");
    const argvPath = join(binDir, "argv.json");
    await writeFile(
      fakeCodex,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
console.log('< item completed: AgentMessage { id: "msg_1", text: "ok", phase: Some(FinalAnswer), memory_citation: None }');
process.exit(0);
`,
      { mode: 0o755 },
    );

    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, "apps/local-api/src/runtime/host/codex-app-server-acp.ts", "--codex", fakeCodex],
      {
        cwd: join(import.meta.dirname, "../../.."),
        stdio: ["pipe", "pipe", "inherit"],
      },
    );
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const conn = new ClientSideConnection((_agent): Client => ({
      sessionUpdate: async () => undefined,
    } as unknown as Client), stream);

    try {
      await conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      const session = await conn.newSession({ cwd: binDir, mcpServers: [] });

      expect(session.modes).toEqual({
        currentModeId: "codex:review",
        availableModes: [
          { id: "codex:review", name: "Review", description: "Ask before applying changes" },
          { id: "codex:full-access", name: "Full access", description: "Codex can edit and run tools" },
        ],
      });

      await expect(conn.setSessionMode({
        sessionId: session.sessionId,
        modeId: "codex:full-access",
      })).resolves.toEqual({});

      await expect(conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello" }],
      })).resolves.toMatchObject({ stopReason: "end_turn" });

      const argv = JSON.parse(await readFile(argvPath, "utf8")) as string[];
      expect(argv).toEqual([
        "--dangerously-bypass-approvals-and-sandbox",
        "debug",
        "app-server",
        "send-message-v2",
        "hello",
      ]);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  it("turns Codex app-server final agent messages into ACP message chunks", async () => {
    const binDir = join(tmpdir(), `clash-fake-codex-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const fakeCodex = join(binDir, "codex");
    await writeFile(
      fakeCodex,
      `#!/usr/bin/env node
const debugIndex = process.argv.indexOf("debug");
if (debugIndex < 0 || process.argv.slice(debugIndex, debugIndex + 3).join(" ") !== "debug app-server send-message-v2") {
  console.error("unexpected argv", process.argv.slice(2).join(" "));
  process.exit(2);
}
console.log('< item completed: AgentMessage { id: "msg_1", text: "Codex made a canvas scene.", phase: Some(FinalAnswer), memory_citation: None }');
process.exit(0);
`,
      { mode: 0o755 },
    );

    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, "apps/local-api/src/runtime/host/codex-app-server-acp.ts", "--codex", fakeCodex],
      {
        cwd: join(import.meta.dirname, "../../.."),
        stdio: ["pipe", "pipe", "inherit"],
      },
    );

    const updates: unknown[] = [];
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const conn = new ClientSideConnection((_agent): Client => ({
      sessionUpdate: async (params: unknown) => {
        updates.push(params);
      },
    } as unknown as Client), stream);

    try {
      await expect(conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })).resolves.toMatchObject({
        protocolVersion: PROTOCOL_VERSION,
      });
      const session = await conn.newSession({ cwd: binDir, mcpServers: [] });
      await expect(conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "make a scene" }],
      })).resolves.toMatchObject({ stopReason: "end_turn" });

      expect(updates).toContainEqual({
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Codex made a canvas scene.",
          },
        },
      });
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  it("streams Codex app-server tool events through the ACP wrapper", async () => {
    const binDir = join(tmpdir(), `clash-fake-codex-tool-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const fakeCodex = join(binDir, "codex");
    await writeFile(
      fakeCodex,
      `#!/usr/bin/env node
const events = [
  {
    jsonrpc: "2.0",
    method: "item/started",
    params: {
      item: {
        type: "commandExecution",
        id: "call_pwd",
        command: "/bin/zsh -lc pwd",
        cwd: ${JSON.stringify(binDir)},
        status: "inProgress",
      },
    },
  },
  {
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      item: {
        type: "commandExecution",
        id: "call_pwd",
        command: "/bin/zsh -lc pwd",
        cwd: ${JSON.stringify(binDir)},
        status: "completed",
        aggregatedOutput: ${JSON.stringify(`${binDir}\n`)},
        exitCode: 0,
      },
    },
  },
  {
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      item: {
        type: "agentMessage",
        id: "msg_1",
        text: "Done",
        phase: "final_answer",
      },
    },
  },
];
for (const event of events) {
  for (const line of JSON.stringify(event, null, 2).split("\\n")) {
    console.log("< " + line);
  }
  if (event.method === "item/started") {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
}
`,
      { mode: 0o755 },
    );

    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, "apps/local-api/src/runtime/host/codex-app-server-acp.ts", "--codex", fakeCodex],
      {
        cwd: join(import.meta.dirname, "../../.."),
        stdio: ["pipe", "pipe", "inherit"],
      },
    );

    const updates: unknown[] = [];
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const conn = new ClientSideConnection((_agent): Client => ({
      sessionUpdate: async (params: unknown) => {
        updates.push(params);
      },
    } as unknown as Client), stream);

    try {
      await conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const session = await conn.newSession({ cwd: binDir, mcpServers: [] });
      let promptSettled = false;
      const promptPromise = conn.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "run pwd" }],
      }).finally(() => {
        promptSettled = true;
      });

      await waitForCondition(() => updates.some((update) =>
        (update as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "tool_call",
      ));
      expect(promptSettled).toBe(false);

      await expect(promptPromise).resolves.toMatchObject({ stopReason: "end_turn" });

      expect(updates).toEqual([
        {
          sessionId: session.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call_pwd",
            title: "/bin/zsh -lc pwd",
            kind: "execute",
            status: "in_progress",
            rawInput: { command: "/bin/zsh -lc pwd", cwd: binDir },
          },
        },
        {
          sessionId: session.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_pwd",
            title: "/bin/zsh -lc pwd",
            kind: "execute",
            status: "completed",
            rawInput: { command: "/bin/zsh -lc pwd", cwd: binDir },
            rawOutput: `${binDir}\n`,
          },
        },
        {
          sessionId: session.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "msg_1",
            content: { type: "text", text: "Done" },
          },
        },
      ]);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });
});
