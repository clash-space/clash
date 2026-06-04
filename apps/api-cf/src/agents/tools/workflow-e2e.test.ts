/**
 * LLM-driven e2e tests for workflow_op.
 *
 * These tests connect to a running SupervisorAgent over WebSocket and check:
 *   1. Description test — can the agent explain workflow_op correctly from
 *      the system prompt? Validates tool wiring + prompt updates are picked up.
 *   2. Behavior test — does the agent actually *call* workflow_op when asked
 *      to plan a build/clone? Captures the tool-call arguments from the stream.
 *
 * Gated on api-cf running at API_URL. Skipped otherwise — same pattern as
 * supervisor-e2e.test.ts.
 *
 * Run: pnpm --filter api-cf test -- --run workflow-e2e
 */
import { describe, it, expect } from "vitest";
import { chatWithSupervisor as sendSupervisorChat } from "./e2e-chat";

// api-cf dev server. Makefile binds :8789 but the existing e2e in this
// directory targets :8787 — keep them aligned by environment override.
const API_URL = process.env.API_CF_URL ?? "http://localhost:8787";
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "857d7caa-9fb9-4442-80fa-67bc709a0288";

async function isServerRunning(): Promise<boolean> {
  try {
    await fetch(`${API_URL}/assets/sign?key=test`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a chat message and collect the full response including any tool calls
 * the agent makes along the way. Returns once the stream signals done.
 */
async function chatWithSupervisor(userMessage: string, timeoutMs = 90_000) {
  return sendSupervisorChat({
    apiUrl: API_URL,
    projectId: PROJECT_ID,
    userMessage,
    threadId: `wf-e2e-${Date.now()}`,
    timeoutMs,
  });
}

describe("workflow_op — LLM e2e", () => {
  it("agent describes all three kinds and drop semantics", async () => {
    if (!(await isServerRunning())) {
      console.log("⏭ api-cf not running at", API_URL, "— skipping");
      return;
    }

    const { text } = await chatWithSupervisor(
      "Describe your workflow_op tool in 4-5 short bullets. Cover: " +
        "(a) what the three kinds do, (b) how drop_action_ids works in clone, " +
        "(c) how the dry-run / apply=true distinction works. " +
        "Do NOT call any tools — just explain from memory.",
    );

    console.log("[E2E describe] response:\n", text);
    expect(text.length).toBeGreaterThan(60);

    const t = text.toLowerCase();
    expect(t).toContain("workflow_op");
    expect(t).toContain("build");
    expect(t).toContain("clone");
    expect(t).toContain("adopt");
    // Drop semantics mentioned.
    expect(t).toMatch(/drop|prune|cut/);
    // Dry-run / apply separation mentioned.
    expect(t).toMatch(/apply|dry[- ]?run|preview/);
  }, 120_000);

  it("agent invokes workflow_op with kind=build and apply=false when asked to preview", async () => {
    if (!(await isServerRunning())) {
      console.log("⏭ api-cf not running at", API_URL, "— skipping");
      return;
    }

    const { text, toolCalls } = await chatWithSupervisor(
      "Pick any draft image node on the canvas (use list_canvas_nodes to find one). " +
        "Then call workflow_op with kind='build' to PREVIEW what would run — do not apply. " +
        "Report the target node id and whether the plan has blockers. " +
        "If there are no draft nodes on the canvas, say so and stop.",
    );

    console.log("[E2E build-preview] text:\n", text);
    console.log("[E2E build-preview] tool calls:", JSON.stringify(toolCalls, null, 2));

    // Two acceptable paths:
    //   A) No drafts on canvas → agent lists nodes, reports no drafts, does not
    //      call workflow_op. Still validates list_canvas_nodes fired.
    //   B) Drafts present → agent calls workflow_op with kind=build, apply
    //      omitted or explicitly false.
    const names = toolCalls.map((c) => c.toolName);
    expect(names).toContain("list_canvas_nodes");

    const workflowCalls = toolCalls.filter((c) => c.toolName === "workflow_op");
    if (workflowCalls.length > 0) {
      for (const c of workflowCalls) {
        const input = typeof c.input === "object" && c.input !== null ? c.input : {};
        expect(input).toHaveProperty("kind", "build");
        expect(input).toHaveProperty("target_node_id");
        // Preview path — apply should be absent or false.
        if ("apply" in input) expect(input.apply).toBe(false);
      }
    } else {
      // Must have reasoned that there's nothing to build.
      expect(text.toLowerCase()).toMatch(/no drafts?|nothing to build|no draft node/);
    }
  }, 180_000);
});
