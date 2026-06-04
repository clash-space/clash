import WebSocket from "ws";

export interface CapturedToolCall {
  toolName: string;
  input: Record<string, unknown> | string | null;
}

export interface ChatResult {
  text: string;
  toolCalls: CapturedToolCall[];
}

export interface ChatWithSupervisorOptions {
  apiUrl: string;
  projectId: string;
  userMessage: string;
  threadId?: string;
  timeoutMs?: number;
}

export async function chatWithSupervisor({
  apiUrl,
  projectId,
  userMessage,
  threadId = `e2e-${Date.now()}`,
  timeoutMs = 90_000,
}: ChatWithSupervisorOptions): Promise<ChatResult> {
  const room = `${projectId}:${threadId}`;
  const wsUrl = `${apiUrl.replace(/^http/, "ws")}/agents/supervisor/${room}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pendingInputs = new Map<string, { toolName: string; chunks: string[] }>();
    const toolCalls: CapturedToolCall[] = [];
    let text = "";
    let sawDone = false;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      reject(error);
    };

    const finish = () => {
      if (settled) return;
      sawDone = true;
      if (text.length === 0 && toolCalls.length === 0) {
        fail(new Error("Supervisor stream completed without assistant output"));
        return;
      }
      settled = true;
      cleanup();
      if (ws.readyState === WebSocket.OPEN) ws.close();
      resolve({ text, toolCalls });
    };

    const timer = setTimeout(() => {
      fail(new Error(`Timeout after ${timeoutMs}ms waiting for supervisor stream completion`));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "cf_agent_use_chat_request",
          id: `msg-${Date.now()}`,
          init: {
            method: "POST",
            body: JSON.stringify({
              messages: [
                {
                  id: `user-${Date.now()}`,
                  role: "user",
                  parts: [{ type: "text", text: userMessage }],
                },
              ],
            }),
          },
        }),
      );
    });

    ws.on("message", (raw: WebSocket.Data) => {
      for (const line of raw.toString().split("\n").filter(Boolean)) {
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }

        if (msg?.type !== "cf_agent_use_chat_response") {
          if (msg?.done) finish();
          continue;
        }

        if (msg.error) {
          const body = typeof msg.body === "string" && msg.body.length > 0 ? `: ${msg.body}` : "";
          fail(new Error(`Supervisor stream error${body}`));
          continue;
        }

        if (msg.body) {
          let part: any;
          try {
            part = JSON.parse(msg.body);
          } catch {
            part = null;
          }
          if (part) applyStreamPart(part, pendingInputs, toolCalls, (delta) => {
            text += delta;
          });
        }

        if (msg.done) finish();
      }
    });

    ws.on("error", (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    ws.on("close", (code, reason) => {
      cleanup();
      if (settled) return;
      const reasonText = reason.toString();
      const reasonSuffix = reasonText ? ` reason=${reasonText}` : "";
      const progress = `textChars=${text.length} toolCalls=${toolCalls.length}`;
      if (sawDone) {
        fail(new Error(`Supervisor WebSocket closed after done before resolution (${progress})`));
      } else {
        fail(new Error(`Supervisor WebSocket closed before done (code=${code}${reasonSuffix}; ${progress})`));
      }
    });
  });
}

function applyStreamPart(
  part: any,
  pendingInputs: Map<string, { toolName: string; chunks: string[] }>,
  toolCalls: CapturedToolCall[],
  appendText: (delta: string) => void,
): void {
  switch (part.type) {
    case "text-delta":
      if (typeof part.delta === "string") appendText(part.delta);
      break;
    case "tool-input-start":
      if (part.toolCallId && part.toolName) {
        pendingInputs.set(part.toolCallId, { toolName: part.toolName, chunks: [] });
      }
      break;
    case "tool-input-delta": {
      if (!part.toolCallId || typeof part.inputTextDelta !== "string") break;
      const pending = pendingInputs.get(part.toolCallId);
      if (pending) pending.chunks.push(part.inputTextDelta);
      break;
    }
    case "tool-input-available":
    case "tool-call": {
      const pending = part.toolCallId ? pendingInputs.get(part.toolCallId) : undefined;
      const toolName = part.toolName ?? pending?.toolName ?? "unknown";
      toolCalls.push({ toolName, input: parseToolInput(part.input, pending?.chunks ?? []) });
      if (part.toolCallId) pendingInputs.delete(part.toolCallId);
      break;
    }
  }
}

function parseToolInput(
  input: unknown,
  chunks: string[],
): Record<string, unknown> | string | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string" && input.length > 0) {
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch {
      return input;
    }
  }
  if (chunks.length === 0) return null;
  const joined = chunks.join("");
  try {
    return JSON.parse(joined) as Record<string, unknown>;
  } catch {
    return joined;
  }
}
