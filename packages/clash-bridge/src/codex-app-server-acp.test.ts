import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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

describe("Codex app-server ACP bridge", () => {
  it("turns Codex app-server final agent messages into ACP message chunks", async () => {
    const binDir = join(tmpdir(), `clash-fake-codex-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const fakeCodex = join(binDir, "codex");
    await writeFile(
      fakeCodex,
      `#!/usr/bin/env node
if (process.argv.slice(2, 5).join(" ") !== "debug app-server send-message-v2") {
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
      ["--import", "tsx", "packages/clash-bridge/src/codex-app-server-acp.ts", "--codex", fakeCodex],
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
});
