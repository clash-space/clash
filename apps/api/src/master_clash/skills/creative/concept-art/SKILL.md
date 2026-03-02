---
name: concept-art
description: Visualize characters and scenes through AI image generation
---

# Concept Art Skill

## When to Use
- Creating visual references for characters
- Designing scene compositions
- Generating mood boards or style references

## Workflow
1. **Read the script/outline** - Understand what needs visualization
2. **Create generation nodes** - Use `create_generation_node` with type `image_gen`
3. **Craft effective prompts** (see Prompt Engineering below)
4. **Wait for completion** - Always use `wait_for_generation`
5. **Iterate if needed** - Refine prompts based on results

## Prompt Engineering Best Practices

### Structure
```
[Subject], [Style], [Details], [Lighting], [Mood]
```

### Example Prompts
**Character:**
```
Portrait of a young woman with silver hair and blue eyes,
digital art style, intricate details, soft studio lighting,
mysterious atmosphere, high quality, 4k
```

**Scene:**
```
Ancient library interior with towering bookshelves,
fantasy illustration style, warm candlelight,
dust particles in light beams, atmospheric perspective
```

### Tips
- Be specific about visual characteristics
- Include art style references (e.g., "Studio Ghibli style", "cyberpunk aesthetic")
- Specify lighting conditions
- Add quality modifiers: "high detail", "professional", "4k"
- Avoid negative terms; describe what you want, not what to avoid
