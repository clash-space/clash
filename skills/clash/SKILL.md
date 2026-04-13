---
name: clash
description: >
  AI video production with the Clash platform. Use this skill whenever the user
  mentions Clash, video projects, canvas editing, image/video generation,
  storyboards, or wants to create visual content. Also use when the user asks
  about managing Clash projects, tokens, or CLI setup.
allowed-tools:
  - Bash
metadata:
  author: clash
  version: 1.0.0
  category: video-production
  tags: [video, canvas, generation, storyboard, cli]
---

# Clash — AI Video Production

Clash is a canvas-based platform for AI video production. You interact with it through the `clash` CLI which syncs in real-time with the web app via CRDT.

Run `clash -h` or `clash <command> -h` for full option details on any command.

## Quick Start

```bash
# Verify auth
clash auth status

# List projects
clash projects list --json

# Open canvas with persistent connection (recommended)
clash canvas connect --project <id>

# Work with nodes...
clash canvas list --project <id> --json
clash canvas add --project <id> --type text --label "My Scene" --content "..." --json

# Disconnect when done (auto-exits after 10min idle)
clash canvas disconnect --project <id>
```

## Core Concepts

**Projects** contain a **canvas** with **nodes**. Nodes are the building blocks:

| Type | Purpose |
|------|---------|
| `text` | Content — scripts, prompts, style guides |
| `group` | Container — organizes related nodes |
| `image_gen` / `video_gen` | Generation trigger — creates images or videos |
| `image` / `video` | Asset — holds generated media |

Text nodes in a group provide context for generation nodes in the same group.

## Daemon Mode

Always start with `canvas connect` for multi-command sessions. This keeps a persistent WebSocket connection and avoids reconnecting on every command:

```bash
clash canvas connect --project <id>
# All subsequent canvas commands use the daemon — zero overhead
clash canvas disconnect --project <id>  # or just let it auto-exit
```

## Typical Workflow

1. **Create or select a project**
2. **Connect** to the canvas
3. **Build structure** — groups + text nodes
4. **Generate** — add `image_gen`/`video_gen` nodes or execute existing ones
5. **Review** — list nodes, check statuses
6. **Disconnect**

## References

For detailed information, read these files from the skill directory:

| File | When to read |
|------|-------------|
| [references/setup.md](references/setup.md) | First-time setup, auth issues, environment config |
| [references/canvas.md](references/canvas.md) | Node types, data structures, generation pipeline, grouping patterns |
| [references/commands.md](references/commands.md) | Full command reference with examples |
