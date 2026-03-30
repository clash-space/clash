---
name: canvas-editing
description: >
  Edit canvas nodes in a Clash project. Add, update, delete, list, and search
  nodes. The CLI connects as a Loro CRDT client for real-time sync.
allowed-tools:
  - Bash
metadata:
  author: clash
  version: 0.1.0
  category: video-production
  tags: [canvas, nodes, editing, crdt]
---

# Canvas Editing

The `clash canvas` commands connect via WebSocket as a Loro CRDT client, syncing changes in real-time with other connected clients (browser, agents).

## Node Types

| Type | Description |
|------|-------------|
| `text` | Text/markdown content node |
| `prompt` | Prompt/instruction node |
| `group` | Container group for organizing nodes |
| `image_gen` | Image generation action node |
| `video_gen` | Video generation action node |

## Commands

### List all nodes

```bash
clash canvas list --project <project-id> --json
```

Filter by type:

```bash
clash canvas list --project <id> --type text --json
```

### Get a specific node

```bash
clash canvas get --project <id> --node <node-id> --json
```

### Add a text node

```bash
clash canvas add --project <id> --type text --label "Scene 1" --content "Opening shot of the city skyline at dawn." --json
```

### Add a prompt node

```bash
clash canvas add --project <id> --type prompt --label "Style Guide" --content "Cinematic, warm color grading, 16:9" --json
```

### Add a generation node

```bash
clash canvas add --project <id> --type image_gen --label "Hero Shot" --json
```

### Update a node

```bash
clash canvas update --project <id> --node <node-id> --label "New Label" --content "Updated content" --json
```

### Delete a node

```bash
clash canvas delete --project <id> --node <node-id> --json
```

### Search nodes

```bash
clash canvas search --project <id> --query "skyline" --json
```

Filter search by type:

```bash
clash canvas search --project <id> --query "hero" --type image_gen,video_gen --json
```

## Tips

- Node IDs are short UUIDs (8 chars). Use `clash canvas list --json` to discover them.
- Changes sync immediately to any connected browser session.
- Use `--parent <group-id>` when adding nodes to organize them into groups.
- The `--json` flag is required for reliable parsing of output.
