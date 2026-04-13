# Canvas: Nodes, Structures & Generation

## Node JSON Structure

Every node from `clash canvas list/get --json`:

```json
{
  "id": "8550f3e5",
  "type": "text",
  "data": {
    "label": "Scene Description",
    "content": "A cat wearing shoes..."
  },
  "parent_id": null,
  "position": { "x": 60, "y": 30 },
  "width": 300,
  "height": 400
}
```

## Node Types

### text
Content node. Use for scripts, descriptions, prompts, style guides.

Key fields: `data.label`, `data.content`

### group
Container. Nodes inside a group share context for generation.

Key fields: `data.label`

Children reference the group via `parent_id`.

### image_gen / video_gen
Generation trigger. When added or executed, the platform generates media.

Key fields: `data.actionType`, `data.modelId`, `data.prompt`, `data.modelParams`

### image / video
Asset node. Created automatically when generation completes.

Key fields: `data.status` (`"pending"` → `"completed"` / `"failed"`), `data.src`, `data.prompt`, `data.modelId`

### action-badge
Internal ReactFlow type for generation nodes. You'll see this in `canvas list` output — it's the same as `image_gen`/`video_gen` but rendered differently in the UI.

## Generation Pipeline

```bash
# 1. Create a group
clash canvas add --project <id> --type group --label "Scene 1" --json
# → {"node_id": "a1b2c3d4", ...}

# 2. Add text context (inside group)
clash canvas add --project <id> --type text --label "Prompt" \
  --content "Cinematic sunset over mountains, golden hour, 4K" \
  --parent a1b2c3d4 --json

# 3. Add generation node (inside same group)
clash canvas add --project <id> --type image_gen --label "Sunset" \
  --parent a1b2c3d4 --json

# 4. Platform auto-processes. Or trigger manually:
clash canvas execute --project <id> --node <action-badge-id> --json

# 5. Check result
clash canvas list --project <id> --type image --json
```

The generation system reads text nodes in the same group as context. Always add text nodes before generation nodes.

## Structuring a Project

### Simple (flat)
Text + generation nodes at top level. Quick for single-shot generation.

### Grouped (recommended)
```
Scene 1 (group)
├── Text: "Script: Dawn breaks over the city..."
├── Text: "Style: Cinematic, warm colors, shallow DOF"
└── image_gen: "Hero Shot"

Scene 2 (group)
├── Text: "Script: The protagonist enters..."
└── video_gen: "Scene 2 Animation"
```

### Multi-scene storyboard
Create one group per scene. Each group contains text nodes for script/style and generation nodes for visuals. This maps naturally to a video timeline.

## Task Polling

After triggering generation, the asset node starts as `"status": "pending"`. Poll until done:

```bash
clash tasks wait --task-id <id> --timeout 120 --json
```

Image generation: ~10-30s. Video generation: ~60-120s.
