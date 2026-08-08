# Timeline track categories

Clash stores five structural track categories. They are both an editor
constraint and part of the agent-facing Timeline YAML contract.

## Canonical vertical order

Top to bottom:

1. `effect`
2. `text`
3. `visual`
4. `primary`
5. `audio`

Tracks of one category stay contiguous. Reordering may change order within a
category, but the reducer restores category blocks after every mutation. The
UI does not label the primary lane as “Main Storyline”; its position and icon
carry the distinction.

## Item compatibility

| Track category | Accepted timeline item types |
| --- | --- |
| `effect` | `composition`, `transition` |
| `text` | `text`, `caption` |
| `visual` | `video`, `image`, `solid`, `sticker`, `composition`, `derived-overlay` |
| `primary` | `video`, `audio`, `image`, `solid` |
| `audio` | `audio` |

Clip-local shader effects remain in a visual or primary clip's `effects`
stack. Canvas-linked Remotion compositions are visual assets and default to a
visual overlay lane. The effect lane remains compatible with time-ranged
composition states and transitions; it does not duplicate clip-local
processing.

The primary lane is the semantic edit used by transcript editing. A video may
keep its linked audio there, and an explicitly chosen dialogue/voiceover audio
clip may also be primary. Ordinary music, secondary microphones, ambience and
sound effects default to `audio` lanes and do not enter the transcript edit.

## Mutation rules

- The first item types an empty untyped legacy lane.
- `ADD_ITEM` rejects an incompatible target.
- `MOVE_ITEM` moves between lanes atomically; an invalid move changes nothing.
- Drag previews mark incompatible targets and dropping there is a no-op.
- Old homogeneous lanes are categorized from their items, then their role.
- New visual material becomes primary only when no explicit primary exists.
  Audio-only lanes are not promoted unless `primaryTrackId` explicitly points
  to a compatible primary lane.

## Agent YAML

```yaml
primaryTrackId: story
tracks:
  - id: fx
    category: effect
    items: []
  - id: captions
    category: text
    items: []
  - id: b-roll
    category: visual
    items: []
  - id: story
    category: primary
    items: []
  - id: music
    category: audio
    items: []
```

The YAML parser rejects unknown categories, category/item mismatches, a wrong
vertical order, and a `primaryTrackId` that points at a non-primary typed lane.

## Product reference

The topology follows Final Cut Pro's Magnetic Timeline: connected visual
elements and titles live above the primary storyline, while music and sound
effects live below it. Clash keeps explicit typed lanes, closer to the visible
CapCut organization, instead of adopting Final Cut Pro's trackless internal
model.

- https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac
- https://support.apple.com/guide/final-cut-pro/organize-clips-by-roles-verdbd59f7/mac
