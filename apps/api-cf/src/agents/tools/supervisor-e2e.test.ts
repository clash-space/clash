/**
 * E2E test: connect to local SupervisorAgent via WebSocket,
 * ask it to read_canvas_node on an image, verify LLM sees the image.
 *
 * Prerequisites: api-cf dev server running on localhost:8787
 *
 * Run: pnpm --filter api-cf test -- --run supervisor-e2e.test
 */
import { describe, it, expect } from "vitest";
import { chatWithSupervisor as sendSupervisorChat } from "./e2e-chat";

const API_URL = process.env.API_CF_URL ?? "http://localhost:8787";
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "857d7caa-9fb9-4442-80fa-67bc709a0288";
const THREAD_ID = `e2e-test-${Date.now()}`;

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
  console.log("[E2E] Connecting to supervisor at", API_URL);
  const result = await sendSupervisorChat({
    apiUrl: API_URL,
    projectId: PROJECT_ID,
    userMessage,
    threadId: THREAD_ID,
    timeoutMs,
  });
  console.log("[E2E] Response complete, collected:", result.text.length, "chars");
  return result.text;
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

    expect(response.length).toBeGreaterThan(20);
    // Should NOT contain raw JSON tool output
    expect(response).not.toContain('"type":"content"');
    expect(response).not.toContain("imageData");
    console.log("[E2E] ✓ Response looks like natural language, not JSON dump");
  }, 90_000);
});
