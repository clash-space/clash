# Clash Creative Artifact Benchmarks

This benchmark evaluates what a headless agent leaves in an isolated workspace.
The agent receives an outcome and acceptance criteria, owns the plan, and must
write `submission.json`. The evaluator does not use the agent's final prose as
evidence.

Clash-host cases install the packaged skills but do not create or replace an
`AGENTS.md`. Codex and Claude Code discover the Clash skill from the task, enter
the stdio MCP root command menu, and progressively select typed operations from their live
descriptions, schemas, structured results, and recovery guidance. Outcomes may
name product-level lineage that is part of acceptance, but they do not provide
copy-paste tool arguments or reveal hidden scoring rubrics.

Run one real Codex case:

```bash
pnpm benchmark:artifacts -- \
  --suite benchmarks/creative-artifacts/v2/suite.json \
  --agent codex \
  --model gpt-5.6-sol \
  --quality-reviewer codex \
  --quality-provider openai \
  --quality-model gpt-5.6-sol \
  --case director-street-vlog-cold-open-v2 \
  --out artifacts/headless-benchmarks
```

Run the same case through Claude Code's native headless protocol:

```bash
pnpm benchmark:artifacts -- \
  --suite benchmarks/creative-artifacts/v2/suite.json \
  --agent claude \
  --model "$CLAUDE_BENCH_MODEL" \
  --case director-street-vlog-cold-open-v2 \
  --out artifacts/headless-benchmarks
```

Pi also uses an explicit provider/model pair:

```bash
pnpm benchmark:artifacts -- \
  --suite benchmarks/creative-artifacts/v2/suite.json \
  --agent pi \
  --provider openai \
  --model gpt-5.6-sol \
  --out artifacts/headless-benchmarks
```

Ready Environments reject an omitted model, provider-changing native arguments,
and the generic command adapter. Codex binds the provider to `openai`; Claude
binds it to `anthropic`; Pi requires `--provider` because its provider is
otherwise mutable.

Content-effect cases have explicit semantic `qualityCriteria` separate from
technical acceptance gates. Technical evidence by itself produces
`pending-review`, never a pass. The optional Codex judge uses the explicit
`--quality-provider openai` and `--quality-model`, runs read-only without Clash
tools, and publishes its evaluator/spec identity and every score in an
immutable Evaluation bound to exact artifact SHA-256 evidence and the
`attemptDigest`. Its v1 path reviews image evidence only: if any criterion
requires audio or another unsupported kind, the entire review stays pending
instead of asking the model to infer what it cannot inspect.

Every case directory contains the durable outcome, agent workspace, stdout and
stderr logs, the submitted artifact manifest, an external scorecard, and an
`outcome-result.json` written by the runner. Required gates fail closed.

Both functional and content-effect tracks use the same standardized Environment
pipeline. Each ready case imports one exact product Workspace bundle and must
produce a verified modified Workspace bundle. The runner separately preserves
the adapter-native event stream, a normalized trajectory, a Codex/Pi ATIF-v1.7
structured projection when supported, trusted readback/report artifacts, a
sealed OTLP/JSON trace and receipt, and a sanitized execution lock. Before any Agent
runs, the lock records its explicit model/provider, exact executable
SHA-256/size/version, every installed skill digest, and the Clash plugin
manifest identity plus deterministic runtime digest. The Agent sources are
checked around the main run. Reviewer executable verification remains
runner-private, while public reviewer provenance belongs to its Evaluation and
does not change the Agent Environment or Attempt identity. A successful content
score cannot hide a missing modified Workspace capture.

Every rollout ends with immutable, score-free `attempt.json` covering the Task,
resolved Agent Environment, input and modified Workspace trees, trajectories,
readback, and facts-only OTLP evidence. Technical and quality Evaluations are
separate content-addressed records; versioned policies derive optional
Aggregate and Reward records, and `result-bundle.json` indexes the current
selection. The executor is currently truthfully recorded as `native-local`,
not container-hermetic. The shared contract is documented in
[`../README.md`](../README.md).

The knowledge boundary is intentional: the base Clash skill teaches peer CLI
or MCP navigation; production skills teach creative judgment and revision; MCP
contracts teach live product operation; the benchmark runner owns isolation and
hidden transport/readback checks. No benchmark guidance is injected through a
repository instruction file.

Version 2 contains 21 cases: five each for Director, Timeline/editor, Remotion
character, and mixed workflows, plus a music/rhythm/MV content-effect case.
Director outcomes require exact-time PNGs from
`clash_director_capture`. Remotion characters are editable TSX components
persisted as Canvas `remotion-component` nodes; the stable Canvas node ID is
retained as the Timeline composition `sourceNodeId`, the runtime is `remotion`,
and playable media must come from `clash_timeline_render`. Sampled PNGs are
evaluated from the real rendered media, while the runner retains the MCP
trajectory and trusted product readback separately from agent-authored reports.

Cases may also declare an immutable `inputFixture`. The runner validates a
canonical path/size/SHA-256 manifest, copies the public source pack into the
fresh workspace, validates it again, and records provenance without exposing
hidden evaluation data. `timeline-talking-head-tech-review-v2` uses this path:
its 43.633-second synthetic口播 includes a false start, fillers, repetition,
dead air, a timed transcript, and source audio for a real text-based cut.

Creator names in the catalog are editorial-format shorthand, not likeness or
brand targets. Every corresponding outcome forbids imitation of a real face,
voice, logo, mascot, trade dress, map artwork, or proprietary brand package;
evaluation concerns only the enumerated, observable framing, pacing, narrative,
typographic, and animation traits.

## Version 2 case catalog

| Category           | Case ID                                          | Editorial challenge                                                                                             |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Director           | `director-street-vlog-cold-open-v2`              | Casey Neistat shorthand: occluded arrival, moving medium, prop reveal, and close reaction.                      |
| Director           | `director-challenge-arena-countdown-v2`          | MrBeast shorthand: immediately legible contestants, obstacle, prize, escalation, and finish reaction.           |
| Director           | `director-premium-gadget-hero-v2`                | MKBHD shorthand: dark studio, one accent color, material detail, orbit, and clean hero lockup.                  |
| Director           | `director-future-lab-walkthrough-v2`             | Cleo Abram shorthand: walking introduction, mechanism point, and optimistic scale reveal.                       |
| Director           | `director-investigation-evidence-wall-v2`        | Johnny Harris shorthand: desk, map, and evidence-wall progression from question to finding.                     |
| Timeline           | `timeline-vertical-retention-hook-v2`            | MrBeast shorthand: first-second promise, escalating numeric or scale beats, and payoff tease.                   |
| Timeline           | `timeline-talking-head-tech-review-v2`           | MKBHD shorthand: talking-head jump cuts, restrained typography, motivated product B-roll, and audio continuity. |
| Timeline           | `timeline-productivity-tip-cutdown-v2`           | Ali Abdaal shorthand: friendly problem question, three-step checklist, desk B-roll, and useful takeaway.        |
| Timeline           | `timeline-map-investigation-explainer-v2`        | Johnny Harris shorthand: presenter-plus-map layouts, route and clue buildup, and causal conclusion.             |
| Timeline           | `timeline-street-vlog-mini-story-v2`             | Casey Neistat shorthand: location, movement, obstacle, arrival payoff, and audio-motivated momentum.            |
| Remotion character | `remotion-character-cosmic-question-host-v2`     | Kurzgesagt shorthand: original flat-geometric science host, orbiting icons, and limited-palette pose arc.       |
| Remotion character | `remotion-character-task-juggler-v2`             | Original productivity overlay with planted walk contacts, readable prop handoffs, and follow-through.           |
| Remotion character | `remotion-character-hot-take-reaction-v2`        | Original talking-head reaction overlay progressing through disbelief, insight, and relief.                      |
| Remotion character | `remotion-character-claim-evidence-synthesis-v2` | Two original explainer characters align claim and evidence through continuous contact and resolution.           |
| Remotion character | `remotion-character-channel-sting-v2`            | Original creator sting with weighted impact, recovery, pointing pose, and readable end card.                    |
| Mixed              | `mixed-productivity-mythbust-short-v2`           | Ali Abdaal shorthand: Director desk host, Remotion checklist reaction, and myth-to-tip edit.                    |
| Mixed              | `mixed-challenge-cold-open-v2`                   | MrBeast shorthand: Director challenge arena, Remotion countdown character, and suspense-led final cut.          |
| Mixed              | `mixed-premium-gadget-mini-review-v2`            | MKBHD shorthand: Director product orbit, Remotion metric presenter, and three-point mini review.                |
| Mixed              | `mixed-map-investigation-story-v2`               | Johnny Harris shorthand: Director evidence wall, Remotion guide, sourced geography, and causal reframe.         |
| Mixed              | `mixed-future-tech-optimist-short-v2`            | Cleo Abram shorthand: Director lab reveal, Remotion science guide, and question-to-impact progression.          |
| Music/rhythm/MV    | `remotion-rhythm-mascot-mv-v2`                   | Original pulse mascot choreographed as a four-part phrase against a deterministic 120 BPM audio fixture.        |

The medium mixed review publishes its functional gate in the agent-visible task:
the Stage needs at least four objects, two cameras, three ordered sequence shots,
and one animated track; the canonical Timeline needs at least three tracks, five
items, 270 frames, and image, composition, and text item types, with every media
item retaining the actual kind of its Project Asset. The Director capture
receipt pins its `projectAssetId` output to the final Stage revision, and a
canonical Timeline media item references that same Project Asset. Capture does
not write its Action output back into the source Stage or require a recapture
loop. These are acceptance requirements, not reviewer-only scoring hints.
