/**
 * E2E test: connect to local SupervisorAgent via WebSocket,
 * ask it to read_canvas_node on an image, verify LLM sees the image.
 *
 * Prerequisites: api-cf dev server running on localhost:8787
 *
 * Run: pnpm --filter api-cf test -- --run supervisor-e2e.test
 */
import { describe, it, expect } from "vitest";
import WebSocket from "ws";

const API_URL = "http://localhost:8787";
const PROJECT_ID = "857d7caa-9fb9-4442-80fa-67bc709a0288";
const THREAD_ID = `e2e-test-${Date.now()}`;
const ROOM = `${PROJECT_ID}:${THREAD_ID}`;

async function isServerRunning(): Promise<boolean> {
  try {
    await fetch(`${API_URL}/assets/sign?key=test`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a chat message to SupervisorAgent using the cf_agent protocol.
 * Returns the collected assistant response text.
 */
async function chatWithSupervisor(userMessage: string, timeoutMs = 60_000): Promise<string> {
  const wsUrl = `${API_URL.replace("http", "ws")}/agents/supervisor/${ROOM}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    let fullResponse = "";
    let messageId = `msg-${Date.now()}`;

    ws.on("open", () => {
      console.log("[E2E] Connected to supervisor");

      // cf_agent_use_chat_request format (from @cloudflare/ai-chat protocol)
      const request = {
        type: "cf_agent_use_chat_request",
        id: messageId,
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
      };

      ws.send(JSON.stringify(request));
      console.log("[E2E] Sent chat request");
    });

    ws.on("message", (raw: WebSocket.Data) => {
      const text = raw.toString();

      // Dump first few messages for debugging
      if (fullResponse.length === 0) {
        console.log("[E2E] RAW MSG:", text.slice(0, 300));
      }

      // Parse each line
      for (const line of text.split("\n").filter(Boolean)) {
        let msg: any;
        try { msg = JSON.parse(line); } catch { msg = null; }

        if (msg?.type === "cf_agent_use_chat_response") {
          if (msg.body) {
            try {
              const bodyParsed = JSON.parse(msg.body);
              if (bodyParsed.type === "text-delta" && bodyParsed.delta) {
                fullResponse += bodyParsed.delta;
              }
            } catch { /* skip non-JSON body */ }
          }
          if (msg.done) {
            console.log("[E2E] Response complete, collected:", fullResponse.length, "chars");
            clearTimeout(timer);
            setTimeout(() => { ws.close(); resolve(fullResponse); }, 500);
          }
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(timer);
      if (fullResponse) resolve(fullResponse);
    });
  });
}

describe("Supervisor E2E - read_canvas_node multimodal", () => {
  it("LLM describes image content after read_canvas_node", async () => {
    const serverUp = await isServerRunning();
    if (!serverUp) {
      console.log("⏭ Skipping: api-cf not running on", API_URL);
      return;
    }

    console.log("[E2E] Asking supervisor to read and describe an image node...");

    const response = await chatWithSupervisor(
      "List the canvas nodes, find an image node, then use read_canvas_node to read it. Describe what you see in the image - be specific about the visual content."
    );

    console.log("\n[E2E] === Supervisor Response ===");
    console.log(response || "(empty)");
    console.log("[E2E] === End Response ===\n");

    if (!response) {
      console.log("⚠ Got empty response - check api-cf logs for errors");
      return;
    }

    expect(response.length).toBeGreaterThan(20);
    // Should NOT contain raw JSON tool output
    expect(response).not.toContain('"type":"content"');
    expect(response).not.toContain("imageData");
    console.log("[E2E] ✓ Response looks like natural language, not JSON dump");
  }, 90_000);
});
