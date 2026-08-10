# Quality and Review Gates

Use quality gates to decide whether the Agent should auto-select, regenerate,
ask the user, or block. A generation result is not automatically a usable shot.

## Hard Blockers

Reject a candidate before scoring when it has any of these:

- broken or missing media, failed decode, truncated output;
- unsafe or disallowed content;
- unlicensed reference reuse or unresolved rights restriction;
- wrong person/product/logo/claim where identity or brand is locked;
- severe anatomy, geometry, text, temporal, or motion failure;
- incompatible aspect, duration, or media type that cannot be repaired safely;
- missing provenance for a required production input.

## Weighted Candidate Score

Score each surviving candidate from 0–100 in six dimensions:

| Dimension | Weight | Question |
| --- | ---: | --- |
| brief fit | 25% | Does it perform the shot's message and editorial purpose? |
| continuity | 20% | Does identity, wardrobe, product, scene, direction, and style match? |
| technical quality | 20% | Are image, motion, anatomy, text, audio, and artifacts usable? |
| editability | 15% | Does it have clean handles, readable action, useful duration, and coverage? |
| emotion/originality | 10% | Does it create the intended feeling without generic filler? |
| responsibility | 10% | Are rights, safety, claims, cost, and provenance acceptable? |

Compute the weighted total. Preserve dimension scores and a one-sentence reason;
do not emit a naked number.

## Selection Rules

Auto-select when all are true:

- no hard blocker;
- total score is at least 75;
- for hero/identity/brand shots, total score is at least 82;
- the winner leads the runner-up by at least 8 points;
- no unresolved high-risk judgment exists;
- the approval policy permits autonomous selection.

Ask the user to choose when any are true:

- top-two margin is under 8 points;
- candidates represent different viable creative directions rather than a
  simple quality ranking;
- identity, product, brand, reference rights, or central narrative taste is at
  stake;
- the selected direction commits substantial remaining budget;
- approval policy requires the checkpoint.

When asking, show only the top two or three:

```text
Recommendation: B
A — stronger product clarity; motion feels conventional.
B — stronger emotional hook and edit handle; slightly less literal.
Decision affected: all downstream opening shots.
```

Do not present six unlabeled thumbnails and ask the human to do the Agent's
ranking work.

## Regeneration Rules

Regenerate when:

- every candidate is below threshold;
- the same hard blocker affects the entire batch but a prompt/reference/model
  change can address it;
- the only high score violates a locked requirement;
- the Timeline reveals missing coverage that cannot be repaired editorially.

Change one diagnosed variable at a time. Record the failure class and revision.
Allow one targeted regeneration cycle by default. A second cycle needs a clear
new hypothesis or user approval when paid cost is material.

## Timeline QA

Before apply, verify:

- every selected item resolves to a source node and/or immutable asset;
- no rejected or rights-restricted candidate appears in the edit;
- sequence communicates the intended message within target duration;
- opening hook arrives in the promised window;
- A-roll continuity and B-roll purpose are explicit;
- there are no accidental gaps, overlaps, black frames, or frozen tails;
- dialogue/VO is intelligible and music/SFX do not mask it;
- captions and graphics stay inside platform safe areas;
- transitions serve continuity or rhythm rather than decoration;
- frame rate, aspect, dimensions, and duration match the creative contract.

## Completion Vocabulary

Use precise status labels:

- `planned` — brief/shot plan exists, generation has not completed;
- `assets-ready` — required media exists, no master edit applied;
- `timeline-ready` — master Timeline applied, render not validated;
- `review-required` — a defined human gate is open;
- `blocked` — an external capability, rights, safety, or budget condition stops work;
- `delivered` — requested export exists and validation passed.

Never translate `assets-ready` into “video finished.”

