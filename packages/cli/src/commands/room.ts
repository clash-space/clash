/**
 * `clash room` — talk in a project's group-chat room.
 *
 * Designed to be invoked by a spawned agent (claude-agent-acp /
 * codex / etc.) via its Bash-equivalent tool. The bridge daemon
 * injects two env vars when it spawns the agent:
 *
 *   CLASH_PROJECT_ID       — which project's room to address
 *   CLASH_AGENT_MEMBER_ID  — the calling agent member id (sender)
 *
 * Together with the existing CLASH_API_KEY, these are everything the
 * agent needs. Humans running the CLI by hand can also talk in their
 * own rooms by exporting CLASH_PROJECT_ID + impersonating one of
 * their own agent member ids (server-side ownership check enforces
 * this).
 *
 * Subcommands:
 *   say <text>            POST a message as the current agent
 *   read [--limit N]      GET recent messages (newest first)
 */

import { Command } from "commander";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";

export const roomCommand = new Command("room")
  .description("Talk in a project's group-chat room");

interface RoomMessage {
  id: string;
  sender_kind: "user" | "agent";
  sender_id: string;
  sender_user_id: string;
  text: string;
  at: number;
  mentions?: Array<{ user_id?: string; agent_member_id?: string; agent_template_id?: string }>;
}

interface RoomSyncMeta {
  mode: "local-only" | "cloud-sync";
  remote_room: {
    enabled: boolean;
    status: "disabled" | "imported" | "mirrored" | "failed";
    error?: string;
  };
}

function projectId(): string {
  const p = process.env.CLASH_PROJECT_ID;
  if (!p) {
    process.stderr.write(
      "error: CLASH_PROJECT_ID is not set.\n" +
      "When invoked by the bridge daemon, this is injected automatically.\n" +
      "Set it manually if you're running outside a spawned session.\n",
    );
    process.exit(2);
  }
  return p;
}

function agentMemberId(): string {
  const id = process.env.CLASH_AGENT_MEMBER_ID;
  if (!id) {
    process.stderr.write(
      "error: CLASH_AGENT_MEMBER_ID is not set.\n" +
      "When invoked by the bridge daemon, this is injected automatically.\n" +
      "Set it manually only if you've claimed an agent you want to impersonate.\n",
    );
    process.exit(2);
  }
  return id;
}

export function roomApiErrorMessage(error: unknown, projectId: string): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/^API error 404\b/.test(message)) return null;
  return (
    `Room messages are not available for project ${projectId} on this Clash API. ` +
    "Use a current local-api/cloud API with room support, or fall back to the session response channel."
  );
}

function failRoomCommand(error: unknown, projectId: string): never {
  const roomMessage = roomApiErrorMessage(error, projectId);
  console.error(roomMessage ?? (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

roomCommand
  .command("say")
  .description("Broadcast a message to the project's group-chat room")
  .argument("<text>", "Message body")
  .option("--mention <agent_member_id...>", "Agent member id(s) to @-mention", [])
  .option("--json", "Output the saved message as JSON")
  .action(async (text: string, options: { mention?: string[]; json?: boolean }) => {
    const pid = projectId();
    const senderId = agentMemberId();
    const mentions = (options.mention ?? [])
      .filter((s) => s && s.trim())
      .map((id) => ({ user_id: "", agent_member_id: id.trim() }));
    // user_id is optional in the mention shape; the server resolves the
    // backend member id directly.

    const data = await apiJson<RoomMessage>(`/api/v1/projects/${pid}/room/messages`, {
      method: "POST",
      body: JSON.stringify({
        text,
        sender_kind: "agent",
        sender_id: senderId,
        ...(mentions.length > 0 ? { mentions } : {}),
      }),
    }).catch((error) => failRoomCommand(error, pid));

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      console.log(`✓ posted (id=${data.id})`);
    }
  });

roomCommand
  .command("read")
  .description("Read recent room messages (newest first)")
  .option("--limit <n>", "How many messages to fetch (max 200)", "50")
  .option("--json", "Output as JSON")
  .action(async (options: { limit?: string; json?: boolean }) => {
    const pid = projectId();
    const limit = Math.min(Number(options.limit ?? 50), 200);
    const data = await apiJson<{ messages: RoomMessage[]; sync?: RoomSyncMeta }>(
      `/api/v1/projects/${pid}/room/messages?limit=${limit}`,
    ).catch((error) => failRoomCommand(error, pid));

    if (isJsonMode(options)) {
      printJson(data);
      return;
    }

    if (data.messages.length === 0) {
      console.log("(no messages)");
      return;
    }
    for (const m of data.messages) {
      const t = new Date(m.at * 1000).toLocaleTimeString();
      const tag = m.sender_kind === "agent" ? "agent" : "user";
      console.log(`[${t}] ${tag}/${m.sender_id.slice(0, 12)}: ${m.text}`);
    }
  });
