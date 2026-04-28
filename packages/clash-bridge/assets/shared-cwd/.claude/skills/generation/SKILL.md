---
name: generation
description: Use when the user asks to generate images / videos / clips, or when an existing async task needs tracking. Triggers on "generate", "create an image", "make a video", "render", "what's the status of X task", "wait for it to finish". Use the `clash tasks` CLI subcommands.
---

# Generation tasks

Generation in Clash (image, video, clip edits) runs as background tasks.
You don't kick them off with `clash tasks`; you trigger them by
**executing an action node on the canvas** (see canvas-operations skill,
`clash canvas execute`). The `tasks` subcommand exists to *track* them
afterwards.

## Typical sequence

1. User: "generate a 5-second clip of a sunrise"
2. You: ensure the right action node exists on the canvas (or create one
   via canvas-operations), get its id, then:
   ```bash
   clash canvas execute <action-node-id> --json
   ```
   This returns a task id.
3. Wait for the task:
   ```bash
   clash tasks wait <task-id> --timeout 300 --json
   ```
   `--timeout` is in seconds; default 120 is too short for video. Use
   300 for image gen, 600+ for video. The command blocks until the task
   reaches a terminal state then prints the final status (with the asset
   id when it succeeded).
4. Surface the result. The user can see the new asset on the canvas —
   you don't need to embed it. One sentence is enough: "done — sunrise
   clip is on the canvas".

## Polling without blocking

```bash
clash tasks status <task-id> --json
```

Returns current state without waiting. Useful if the user wants a quick
"is X done yet" check. **Don't loop this in a tight poll** — use `wait`
instead.

## On failure

`tasks wait` exits non-zero if the task ends in `failed` (or times out).
Read the JSON's `error` field and surface it concisely. Common failures:
- model out of credits → suggest the user check billing
- prompt rejected by safety filter → suggest a rewording
- network / upstream error → safe to retry once

## Conventions

- Show the task id you're waiting on in your progress message — the
  user might want to check it themselves on a different device.
- For batch ops (generate 4 variants), kick all four off with `execute`,
  then `wait` on each one in turn (sequential is fine; the user mostly
  cares about the last one finishing). Don't fan out parallel `wait`s.
