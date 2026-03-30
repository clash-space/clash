---
name: generation
description: >
  Generate images and videos using Clash. Submit generation tasks, poll status,
  and wait for completion.
allowed-tools:
  - Bash
metadata:
  author: clash
  version: 0.1.0
  category: video-production
  tags: [generation, image, video, ai]
---

# Generation

Generate images and videos via the Clash platform.

## Workflow

1. Add a generation node to the canvas (triggers auto-generation):

```bash
clash canvas add --project <id> --type image_gen --label "Cityscape at dawn" --json
```

2. The platform auto-processes generation nodes. Check task status:

```bash
clash tasks status --task-id <task-id> --json
```

3. Wait for completion (polls automatically):

```bash
clash tasks wait --task-id <task-id> --timeout 120 --json
```

## Generation Types

| Node Type | What it Does |
|-----------|-------------|
| `image_gen` | Generates an image from upstream prompts |
| `video_gen` | Generates a video from upstream image + prompts |

## Notes

- Generation is asynchronous. Use `clash tasks wait` to block until done.
- The `result_url` in the task response points to the generated asset.
- Default timeout is 120 seconds. Image gen typically takes 10-30s, video gen 60-120s.
- Upstream nodes provide context — link text/prompt nodes as references by placing them in the same group.
