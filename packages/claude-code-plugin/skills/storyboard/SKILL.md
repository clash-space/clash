---
name: storyboard
description: >
  End-to-end storyboard creation workflow. Create a project, build scene
  structure, generate images/videos, and assemble the storyboard.
allowed-tools:
  - Bash
metadata:
  author: clash
  version: 0.1.0
  category: video-production
  tags: [storyboard, workflow, end-to-end, video]
---

# Storyboard Workflow

Complete workflow for creating a video storyboard from scratch.

## Step 1: Create a Project

```bash
clash projects create --name "My Storyboard" --description "A short film about..." --json
```

Save the returned `id` for all subsequent commands.

## Step 2: Create Scene Structure

Create a group for each scene, then add content nodes:

```bash
# Create scene group
clash canvas add --project <id> --type group --label "Scene 1: Opening" --json

# Add script/description
clash canvas add --project <id> --type text --label "Script" --content "Dawn breaks over the city. A lone figure walks through empty streets." --parent <group-id> --json

# Add style direction
clash canvas add --project <id> --type prompt --label "Style" --content "Cinematic, warm golden hour lighting, shallow depth of field" --parent <group-id> --json
```

## Step 3: Generate Images

Add image generation nodes for each scene's key frames:

```bash
clash canvas add --project <id> --type image_gen --label "Scene 1 - Wide Shot" --parent <group-id> --json
```

The platform auto-generates based on upstream text/prompt nodes in the same group.

## Step 4: Generate Videos (Optional)

After images are ready, create video generation nodes:

```bash
clash canvas add --project <id> --type video_gen --label "Scene 1 - Animation" --parent <group-id> --json
```

## Step 5: Review

List all nodes to review the storyboard:

```bash
clash canvas list --project <id> --json
```

## Tips

- Structure: Project → Scene Groups → (Text + Prompt + Generation nodes)
- Always add text/prompt nodes BEFORE generation nodes in the same group.
- The generation system uses upstream nodes as context automatically.
- Use `clash tasks wait --task-id <id>` between generation steps if order matters.
