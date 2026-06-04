import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { chatWithSupervisor } from "./e2e-chat";

async function withServer<T>(
  handler: (socket: WebSocket) => void,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  server.on("connection", handler);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock WebSocket server did not expose a TCP address");
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function chatFrame(body: unknown, done = false): string {
  return JSON.stringify({
    type: "cf_agent_use_chat_response",
    body: typeof body === "string" ? body : JSON.stringify(body),
    done,
  });
}

describe("chatWithSupervisor", () => {
  it("collects text and streamed tool input until the done frame", async () => {
    const result = await withServer(
      (socket) => {
        socket.on("message", () => {
          socket.send(chatFrame({ type: "text-delta", delta: "Looking. " }));
          socket.send(chatFrame({ type: "tool-input-start", toolCallId: "call-1", toolName: "list_canvas_nodes" }));
          socket.send(chatFrame({ type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: "{\"type\":" }));
          socket.send(chatFrame({ type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: "\"image\"}" }));
          socket.send(chatFrame({ type: "tool-input-available", toolCallId: "call-1", toolName: "list_canvas_nodes" }));
          socket.send(chatFrame("", true));
        });
      },
      (apiUrl) => chatWithSupervisor({
        apiUrl,
        projectId: "project-1",
        userMessage: "list images",
        threadId: "thread-1",
      }),
    );

    expect(result.text).toBe("Looking. ");
    expect(result.toolCalls).toEqual([
      { toolName: "list_canvas_nodes", input: { type: "image" } },
    ]);
  });

  it("rejects when the socket closes before a done frame", async () => {
    await expect(
      withServer(
        (socket) => {
          socket.on("message", () => socket.close(1011, "worker crashed"));
        },
        (apiUrl) => chatWithSupervisor({
          apiUrl,
          projectId: "project-1",
          userMessage: "hello",
          threadId: "thread-2",
        }),
      ),
    ).rejects.toThrow(/closed before done.*worker crashed/);
  });

  it("rejects when the stream completes without text or tool calls", async () => {
    await expect(
      withServer(
        (socket) => {
          socket.on("message", () => socket.send(chatFrame("", true)));
        },
        (apiUrl) => chatWithSupervisor({
          apiUrl,
          projectId: "project-1",
          userMessage: "hello",
          threadId: "thread-3",
        }),
      ),
    ).rejects.toThrow(/completed without assistant output/);
  });
});
