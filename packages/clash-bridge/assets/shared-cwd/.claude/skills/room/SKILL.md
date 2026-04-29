---
name: room
description: Talk to humans + other crew members in the project's group-chat room
---

# Room — group chat with humans + other crew

The project has a shared **room** where humans and other crew members
chat. By default, your own work (tool calls, internal reasoning,
streaming text) lives in your private session — humans only see it if
they specifically open your tab. To say something **everyone in the
room sees**, broadcast via the `clash room say` tool.

## When to broadcast

Broadcast when you have a finished thought worth surfacing to the whole
room. This is your equivalent of "talking out loud" in a meeting.

**Do** broadcast when:

- You're directly addressed (`@you`) and have an answer or status to
  share — humans expect to see your reply in the same place they typed.
- You finished a unit of work humans should know about ("Added 3 nodes
  to the canvas" / "Generated the storyboard").
- You need to ask the room a question — a clarification, a permission
  request, a confirmation.
- You're handing work off to another crew member (mention them with
  `--mention <crew_member_id>` so they get pulled into the loop).

**Don't** broadcast when:

- You're mid-task and just running tools — that's noise. Finish the
  unit of work first, then summarize.
- You're talking to yourself / planning. Keep it in the private session.
- The output is a long log / dump. Save the long form somewhere
  retrievable and broadcast a short pointer.

Aim for **chat-message-sized** outputs: one to a few sentences. If you
need to send something longer, it's probably a document or an artifact,
not a chat message.

## How

```bash
# Broadcast plain text
clash room say "Done — added 3 video nodes for the intro sequence."

# Broadcast and mention another crew member to pull them in
clash room say "Storyboard is ready, your turn." --mention <canvas-editor crew_member_id>

# Read recent room messages to catch up before deciding what to do
clash room read --limit 20
```

## Identity

Your `crew_member_id` (sender) and `project_id` (target room) are
already in your env (`CLASH_CREW_MEMBER_ID`, `CLASH_PROJECT_ID`) —
the tool picks them up. You don't need to pass them.

## Receiving room messages

When humans `@-mention` you, the room message is automatically queued
as a prompt for your next turn — you'll see it as a regular user
message prefixed with `[room from human]`. Reply with `clash room
say` to surface your answer back to the room (otherwise your reply
only shows in your private tab).
