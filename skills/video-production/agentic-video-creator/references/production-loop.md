# Production Loop

Use this state machine to turn a brief into an inspectable, resumable production
run. Do not advance a stage only in private reasoning; every stage leaves an
artifact, Clash entity, or review decision.

## Stage 1: Brief

Inputs:

- user request and supplied media;
- Project inventory;
- platform/delivery context;
- budget and rights constraints.

Outputs:

- `brief/creative-contract.md`;
- one brief node on the `creative` Canvas;
- selected specialist skill, if any;
- risk flags and approval policy.

Default missing values only when they are reversible. For an unspecified social
video, propose a sensible duration/aspect from context and record it. For a
regulated ad, brand likeness, or licensed reference, ask before generating.

## Stage 2: Look Development

Lock the reusable anchors before shot fan-out:

- narrative tone and visual grammar;
- character identity, wardrobe, product, logo, or location anchors;
- palette, lighting, lens/camera, texture, graphics, and audio direction;
- negative constraints and continuity rules.

Generate two to four meaningfully different look directions only when look is
not already supplied. Use a human checkpoint when choosing the wrong direction
would invalidate many downstream assets.

Outputs:

- `plans/style-bible.md`;
- approved reference asset/node IDs;
- `reviews/lookdev-selection.json` when a gate is needed.

## Stage 3: Storyboard and Coverage Plan

Break the concept into editorial beats, then shots. Every planned shot should
contain:

- `shotId` and beat/purpose;
- A-roll or B-roll role;
- subject/action;
- framing and camera motion;
- target duration or frame range;
- dialogue/VO/music relationship;
- required reference anchors;
- generation risk and candidate count;
- continuity in/out requirements.

Use B-roll deliberately:

| Purpose | Example |
| --- | --- |
| explain | product detail while VO names a feature |
| cover | cutaway over a dialogue edit or continuity jump |
| feel | environment or reaction that carries emotion |
| pace | insert/detail used to compress or accelerate time |
| transition | match action, movement, color, or sound bridge |

Outputs:

- `plans/shot-list.json`;
- storyboard/keyframe nodes at the start of each sequence or shot Group;
- initial `plans/candidate-matrix.json`.

## Stage 4: Generate

Route each planned shot to its draft Canvas. Inside a Canvas, create a Group for
each coherent generation path and group related shots by scene, beat, character,
product, or purpose. A Group is one path; the Canvas is the larger draft
context.

A Flova-like draft path maps to Clash as:

```text
Group label / path intent
|- brief or shot text
|- storyboard / keyframe / timing intent
|- reference asset placements
|- primary-action generation hypotheses (A-roll role)
|  `- primary candidate assets
|- coverage generation hypotheses (B-roll role)
|  `- detail, reaction, environment, transition candidates
`- select note: winner, reason, and Timeline eligibility
```

Do not encode the path as another workflow engine. Node lineage and visible
grouping are the draft representation; selected immutable assets and the
Timeline are the durable handoff.

Storyboard, A-roll, and B-roll are not sibling storage domains. Storyboard is
the intent for the shot; A-roll and B-roll are editorial roles of candidate
material created against that intent. Keep them together unless a genuinely
different creative context or team boundary requires isolation.

For every generation node, record:

- shot ID and candidate hypothesis;
- exact prompt and negative constraints;
- model/action and parameters;
- reference node/asset IDs;
- task ID, status, output node ID, and output asset ID;
- cost/attempt counter.

Run candidate jobs as a batch. A failed job is not a creative candidate and does
not enter ranking.

## Stage 5: Selects

Create a candidate record even when the Agent can auto-select:

```json
{
  "shotId": "shot-03",
  "candidates": [
    {
      "nodeId": "node-a",
      "assetId": "asset-a",
      "hypothesis": "medium tracking shot, controlled product reveal",
      "scores": {
        "briefFit": 88,
        "continuity": 84,
        "technical": 91,
        "editability": 86,
        "emotion": 79,
        "responsibility": 100
      },
      "total": 87,
      "verdict": "selected"
    }
  ],
  "selectionMode": "auto",
  "reason": "clear score margin with no identity, brand, or rights blocker"
}
```

Store the aggregate at `reviews/selects.json`. Keep the select note in the
generating Group. Create a separate review surface only when the run has enough
candidates or collaborators to justify a different review context.

## Stage 6: Edit

Create the standalone master Timeline after the first selects are stable. A
Timeline is the final ordering surface; do not mirror its sequence by moving
Canvas nodes around.

Recommended passes:

1. radio/story cut — message, dialogue, VO, and duration;
2. picture cut — A-roll and chosen B-roll;
3. rhythm pass — beats, reaction time, shot density, sound bridges;
4. continuity pass — identity, screen direction, props, color, temporal logic;
5. graphics/caption pass;
6. audio balance and final polish.

Record every Timeline item with its selected source node and immutable asset
where possible. Keep alternates on their source Canvas, not hidden in the master
cut.

## Stage 7: QA

Run the gates in `quality-gates.md`. Repair safe issues autonomously. Re-open a
human gate only when the repair changes approved identity, claims, rights,
direction, or final message.

Outputs:

- `qa/creative-review.json`;
- domain-specific QA artifacts;
- final approval gate when required.

## Stage 8: Delivery

Rendering and delivery are separate from Timeline completion. If the user asks
for a finished file, require the relevant render/export action and validation
receipt. If the current host cannot render the standalone Timeline, report
`timeline-ready` rather than `finished-video`.

## Canvas Topology Heuristic

Use the fewest Canvases that keep work understandable:

| Job | Suggested Canvases |
| --- | --- |
| simple 6–15s visual | one `drafts` Canvas, Groups per beat |
| talking head with coverage | one `episode` Canvas; Groups couple transcript beats, main footage, and coverage |
| 20–60s narrative/TVC | `development` plus one `main-sequence` Canvas; split further only for real sequence boundaries |
| multi-scene episode | `development`, then `sequence-01`, `sequence-02`, ... |
| competing creative routes | one Canvas per direction until a route is selected |
| image-only storyboard | one `storyboard-draft` Canvas with Groups per beat/shot |

Remember that every Canvas is a draft room. Do not create a new Canvas because a
node list is untidy. Create one when the material has a different production
purpose, sequence context, review owner, or deliberately isolated direction. Use
a Group when the context stays the same and only the beat, shot, coverage role,
or hypothesis changes. Never split a shot across storyboard/A-roll/B-roll
Canvases merely because the assets have different editorial roles.
