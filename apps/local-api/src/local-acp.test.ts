import { describe, expect, it, vi } from "vitest";
import { createLocalAcpAdapter, type SessionManagerLike } from "./local-acp";

describe("local ACP adapter", () => {
  it("reports the desktop local runtime from detected ACP agents", async () => {
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
      ],
      hostname: () => "This Mac",
      osTag: () => "darwin/arm64",
      nowSeconds: () => 1_700_000_000,
    });

    await expect(adapter.listRuntimes()).resolves.toEqual({
      runtimes: [
        {
          id: "desktop-local",
          machine_id: "desktop-local",
          hostname: "This Mac",
          os: "darwin/arm64",
          agents: [{ id: "codex-cli", binary: "codex" }],
          version: "desktop",
          status: "online",
          last_heartbeat: 1_700_000_000,
          created_at: 1_700_000_000,
        },
      ],
    });
  });

  it("starts ACP sessions with the first detected local agent", async () => {
    const start = vi.fn<SessionManagerLike["start"]>(async () => undefined);
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
      ],
      createSessionManager: () => ({ start, prompt: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }),
      createSessionId: () => "local-acp-session-1",
    });

    await expect(adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "director",
      projectId: "project-1",
      resumeAcpSessionId: "acp-existing",
    })).resolves.toEqual({ session_id: "local-acp-session-1" });

    expect(start).toHaveBeenCalledWith({
      session_id: "local-acp-session-1",
      crew_id: "director",
      agent_id: "codex-cli",
      project_id: "project-1",
      resume: { acp_session_id: "acp-existing" },
    });
  });
});
