/**
 * `clash room` — talk in a project's group-chat room.
 *
 * Designed to be invoked by a spawned crew agent (claude-code-acp /
 * codex / etc.) via its Bash-equivalent tool. The bridge daemon
 * injects two env vars when it spawns the agent:
 *
 *   CLASH_PROJECT_ID       — which project's room to address
 *   CLASH_CREW_MEMBER_ID   — the calling crew_member.id (sender)
 *
 * Together with the existing CLASH_API_KEY, these are everything the
 * agent needs. Humans running the CLI by hand can also talk in their
 * own rooms by exporting CLASH_PROJECT_ID + impersonating one of
 * their own crew_member ids (server-side ownership check enforces
 * this).
 *
 * Subcommands:
 *   say <text>            POST a message as `sender_kind=crew`
 *   read [--limit N]      GET recent messages (newest first)
 */

import { Command } from "commander";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";

export const roomCommand = new Command("room")
  .description("Talk in a project's group-chat room");

interface RoomMessage {
  id: string;
  sender_kind: "user" | "crew";
  sender_id: string;
  sender_user_id: string;
  text: string;
  at: number;
  mentions?: Array<{ user_id: string; crew_member_id?: string; crew_id?: string }>;
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

function crewMemberId(): string {
  const cm = process.env.CLASH_CREW_MEMBER_ID;
  if (!cm) {
    process.stderr.write(
      "error: CLASH_CREW_MEMBER_ID is not set.\n" +
      "When invoked by the bridge daemon, this is injected automatically.\n" +
      "Set it manually only if you've claimed a crew you want to impersonate.\n",
    );
    process.exit(2);
  }
  return cm;
}

roomCommand
  .command("say")
  .description("Broadcast a message to the project's group-chat room")
  .argument("<text>", "Message body")
  .option("--mention <crew_member_id...>", "Crew member id(s) to @-mention", [])
  .option("--json", "Output the saved message as JSON")
  .action(async (text: string, options: { mention?: string[]; json?: boolean }) => {
    const pid = projectId();
    const senderId = crewMemberId();
    const mentions = (options.mention ?? [])
      .filter((s) => s && s.trim())
      .map((id) => ({ user_id: "", crew_member_id: id.trim() }));
    // user_id is optional in the new mention shape — leave blank;
    // server resolves crew_member_id directly. Kept the field for
    // schema compatibility with browser-sent mentions.

    const data = await apiJson<RoomMessage>(`/api/v1/projects/${pid}/room/messages`, {
      method: "POST",
      body: JSON.stringify({
        text,
        sender_kind: "crew",
        sender_id: senderId,
        ...(mentions.length > 0 ? { mentions } : {}),
      }),
    });

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
    const data = await apiJson<{ messages: RoomMessage[] }>(
      `/api/v1/projects/${pid}/room/messages?limit=${limit}`,
    );

    if (isJsonMode(options)) {
      printJson(data.messages);
      return;
    }

    if (data.messages.length === 0) {
      console.log("(no messages)");
      return;
    }
    for (const m of data.messages) {
      const t = new Date(m.at * 1000).toLocaleTimeString();
      const tag = m.sender_kind === "crew" ? "crew" : "user";
      console.log(`[${t}] ${tag}/${m.sender_id.slice(0, 12)}: ${m.text}`);
    }
  });
