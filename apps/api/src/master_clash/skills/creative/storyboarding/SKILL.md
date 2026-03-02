---
name: storyboarding
description: Create shot sequences and visual flow for video production
---

# Storyboarding Skill

## When to Use
- Breaking down a script into visual shots
- Planning camera movements and transitions
- Creating a visual narrative flow

## Workflow
1. **Review script and characters** - Read existing nodes
2. **Plan shot sequence**
   - Identify key moments
   - Determine shot types (wide, medium, close-up)
   - Plan transitions between scenes
3. **Create shot nodes** - Use `create_generation_node` for each shot
4. **Add shot descriptions** - Include camera direction in content

## Shot Types Reference

| Shot Type | Use Case | Example |
|-----------|----------|---------|
| Establishing | Set location/mood | Wide shot of city skyline |
| Wide | Show environment | Full room with characters |
| Medium | Dialogue, action | Characters from waist up |
| Close-up | Emotion, detail | Face showing reaction |
| Insert | Important objects | Hand picking up key |

## Shot Description Format
```
**Shot 3: Medium - Alice's Discovery**
- Frame: Medium shot, Alice center frame
- Action: Alice opens the mysterious box
- Duration: 3 seconds
- Transition: Cut to close-up of box contents
- Notes: Emphasize wonder on her face
```

## Creating Shot Nodes
For each shot:
1. Create `image_gen` node for still reference
2. Or create `video_gen` node for motion
3. Include full prompt in content field
4. Label clearly: "Shot 1: Opening Wide"
