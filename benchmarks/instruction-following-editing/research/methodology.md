# Proposed methodology

Status: design findings only. Numeric weights and leaderboard policy are not yet
frozen.

## Research question

Can an agent transform a fully specified, initialized video-editing Environment
into a valid edited deliverable and editable project that satisfy a natural
language brief, while preserving everything the brief did not authorize?

That question is narrower and more falsifiable than “did the agent make a good
video?” It separates:

- understanding the instruction;
- selecting and operating tools;
- producing correct media and project state;
- preserving unrequested content;
- producing an editorially effective result; and
- doing so with an auditable trajectory.

## Unit of evaluation

Each case should contain four layers.

### 1. Public brief

The agent sees a natural-language request written as a realistic editorial
brief. It may include:

- desired narrative and audience;
- exact duration or a tolerance;
- source-use constraints;
- required and forbidden shots;
- shot order or timing relationships;
- audio, caption, text, crop, and transition requirements;
- delivery format; and
- preservation requirements.

The brief should not expose hidden implementation details or the evaluator
schema.

### 2. Initialized evaluation Environment

The Environment contains everything required to attempt the task:

- one portable Clash Workspace or an equivalent neutral media fixture;
- source assets and stable semantic/time markers;
- allowed tools and policy;
- agent profile and model;
- installed plugin identities and versions;
- runtime and resource limits; and
- network policy.

`Workspace` remains the product-level editable project. `Environment` is the
evaluation/RL envelope that adds execution configuration around it.

### 3. Hidden executable oracle

The oracle is a set of properties, not a secret canonical MP4. Requirements are
split into:

- **EDIT_TO_PASS**: facts that must become true;
- **PASS_TO_PASS**: facts that were true initially and must remain true; and
- **MUST_NOT**: unauthorized operations, content, or side effects.

This terminology intentionally borrows the useful pattern from SWE-bench. The
underlying checks are media, timeline, and Workspace checks rather than unit
tests.

### 4. Runner-owned evidence

The agent does not self-report success. The runner captures:

- the immutable initial Environment digest;
- the final modified Environment or a content-addressed snapshot;
- rendered artifacts and their hashes;
- trusted tool-operation evidence;
- the evaluator output and oracle version; and
- an OTLP-compatible trajectory with model/tool/runtime spans.

## Two benchmark tracks

Both tracks use the same runner and evidence envelope. They differ in what can
serve as ground truth.

### Track A: functional instruction following

Use detailed briefs and synthetic or redistributable fixtures whose relevant
events are machine-observable. Examples:

- trim source A to a specified semantic event;
- place source B immediately after it;
- keep a marked spoken phrase and remove another;
- freeze on a known frame for a specified duration;
- add an exact caption during a known interval;
- mix music under speech with loudness and ducking constraints;
- export a specified duration, aspect ratio, frame rate, and audio layout; and
- preserve an unrelated interval bit-semantically or perceptually within a
  defined tolerance.

This is the cleanest place to compare a shell/FFmpeg agent with a Clash agent.
The public brief and hidden semantic oracle are identical; only the tool adapter
and project-integrity scorer differ.

### Track B: content effect and editorial quality

Use open-ended but bounded briefs such as talking-head tightening, interview
B-roll, tutorial clarity, product story, music montage, or trailer pacing.

Ground truth should combine:

- multiple professional reference timelines where feasible;
- temporal overlap and cut-alignment metrics inspired by MEDit-Bench;
- explicit structural checks;
- blinded human pairwise preference or rubric scores; and
- a model judge only after held-out human calibration.

This track should report ambiguity and contextfulness slices. A single encoded
reference video is not sufficient because good edits can differ legitimately.

## Programmatic scoring layers

Report a score vector first. Do not collapse it into one public scalar until
human calibration shows that the aggregation has the intended meaning.

### Delivery validity gate

Examples:

- artifact exists and decodes completely;
- duration, dimensions, rotation, frame rate, codecs, and audio layout are valid;
- no black/error tail or missing stream;
- required Workspace/project is readable and not corrupt; and
- no unresolved pending output is presented as success.

A failed validity gate cannot be compensated by aesthetic quality.

### Instruction accuracy

Each independently meaningful clause in the brief becomes a typed predicate.
Examples:

- selected source identity and interval;
- required event present;
- forbidden event absent;
- ordering and adjacency;
- temporal overlap and boundary tolerance;
- target duration;
- exact on-screen string and visibility interval;
- speech phrase presence/absence via a pinned ASR protocol;
- beat alignment within tolerance;
- crop/position/scale bounds; and
- audio stream, loudness, silence, or ducking behavior.

Use source-local hidden markers rather than filenames alone. Synthetic fixtures
can encode frame/time identifiers, tones, speech tokens, colors, and semantic
events so that different correct implementations remain measurable.

### Preservation / no regression

This prevents shortcut solutions. Checks can include:

- unaffected source intervals retained;
- no duplicate footage above an overlap threshold;
- no unexpected speed change, reframing, color shift, or audio replacement;
- unmentioned text and logos preserved;
- no unrelated Workspace entities modified; and
- no wholesale re-encode accepted as preservation when exact media copying was
  required.

This layer corresponds to VEFX-Bench's “edit exclusivity” and to the preservation
dimensions of IVEBench, CoVEBench, and OmniEdit-Bench.

### Timeline and project integrity

Applicable to editable systems such as Clash:

- source references resolve to the intended immutable assets;
- clip intervals and ordering agree with the render;
- history and revision identities are valid;
- downstream output provenance points to the frozen upstream revision;
- no dangling bindings or missing Resource/Document bodies exist; and
- the final Workspace can be exported, imported into a fresh Host, reopened, and
  rendered equivalently.

This score is reported separately from render correctness. FFmpeg can earn full
artifact correctness without pretending to have editable-project semantics.

### Editorial effect

Use humans or a calibrated judge for properties that are not fully reducible to
predicates:

- narrative clarity;
- pacing;
- emotional or persuasive effect;
- shot variety and continuity;
- music–story alignment;
- visual hierarchy; and
- overall preference.

Deterministic failures remain failures. A content judge may not override a
missing required shot, wrong duration, corrupted project, or fabricated tool
trace.

### Efficiency and process

Report, but do not silently blend into quality:

- wall time and model latency;
- tokens and cost;
- tool calls and failed calls;
- retries and recovery;
- peak compute/memory where available; and
- prohibited-tool or policy violations.

## Learned evaluator credibility

An evaluator agent is not academically credible merely because it uses the same
dimensions as VE-Bench, IVEBench, or VEFX-Bench. That establishes vocabulary,
not validity.

For a new judge to count as evidence, publish at least:

1. **Target distribution** — the exact NLE categories, sources, durations, and
   systems on which it will be used.
2. **Independent human labels** — held-out from judge development and balanced
   across systems and failure modes.
3. **Reliability** — human–human agreement and judge–human agreement with
   confidence intervals.
4. **Ranking validity** — pairwise accuracy plus rank correlations where scalar
   scores are claimed.
5. **Bias probes** — swapped presentation order, system/tool identity masking,
   verbosity/style controls, and self-enhancement tests.
6. **Negative controls** — no-op edit, wrong-source edit, pretty but wrong edit,
   collateral edit, repeated clip, missing audio, wrong duration, and corrupted
   render.
7. **Failure slices** — category, duration, ambiguity, aspect ratio, audio,
   language, and tool/system.
8. **Version pinning** — model/checkpoint, prompt, sampler, frame extraction,
   dependency versions, and deterministic aggregation.
9. **Drift policy** — a new API/model version is a new evaluator version and
   must be recalibrated.

VE-Bench QA, VEFX-Reward, and TDVE-Assessor should be run as published baselines.
Matching or improving their human correlation on a held-out NLE calibration set
would support the new judge. It would not make the judge the sole oracle.

MEDit-Bench's finding of severe position bias and EditDuet's positive
human-calibration result are both important: model judges can work in a bounded
distribution, and they can also fail badly in a nearby editing task.

## External credibility contract

If outside researchers do not initially accept the scoring standard, the answer
is auditability rather than rhetoric:

- pre-register the suite version and scoring protocol before running headline
  systems;
- publish fixtures or license-clean reproducible generators;
- publish the full public split and keep a separately governed held-out split;
- publish oracle code, hashes, tolerance rationale, and negative-control tests;
- have independent editors review every brief and oracle;
- label each task for ambiguity, contextfulness, and expected solution breadth;
- publish FFmpeg, Clash, no-op, adversarial, and human-editor baselines;
- run more than one stochastic attempt and report confidence intervals;
- report per-category scores and failure counts, not only a single average;
- invite external submissions through a reproducible, runner-owned harness; and
- version corrections without rewriting historical leaderboard results.

The benchmark earns legitimacy through demonstrated construct validity,
reproducibility, and independent use. Borrowed metric names alone do not confer
that legitimacy.

## Trace and modified-Environment contract

Use OpenTelemetry as the transport envelope, not as the benchmark ontology.

Suggested score-free Attempt span hierarchy:

```text
benchmark.attempt
├── environment.materialize
├── agent.run
│   ├── model.request
│   ├── tool.call
│   ├── workspace.mutation
│   └── render
└── environment.snapshot
```

Requirements:

- emit standard OTLP JSON or protobuf;
- pin the OpenTelemetry and semantic-convention versions;
- use standard HTTP/RPC/process/exception attributes when applicable;
- namespace benchmark attributes, for example `clash.eval.case.id`;
- store large prompts, frames, artifacts, and tool payloads by digest rather than
  as high-cardinality span attributes;
- redact credentials, local absolute paths, and private chain-of-thought;
- cryptographically bind the trace, final Environment, and rollout artifacts
  into one immutable score-free Attempt;
- publish each evaluator result separately with its own provenance and a
  reference to the `attemptDigest`, so several dimensions can score the same
  trajectory without rewriting it;
- distinguish runner-observed events from agent-authored text; and
- retain raw logs separately from the normalized trace.

Evaluation instrumentation may use a separate trace, but evaluator spans,
scores, verdicts, aggregates, rewards, and reports must never be inserted into
the Attempt trace. A replaceable Result Bundle may reference the immutable
Attempt and selected immutable Evaluation-derived records.

## Case quality review

Before admission, every case should pass a video equivalent of the SWE-bench
Verified review:

- Is the brief solvable from the provided Environment?
- Are all required facts visible or discoverable to the agent?
- Do executable checks test the brief instead of one author implementation?
- Can a valid alternative edit pass?
- Can a trivial shortcut or no-op pass?
- Are tolerance values justified by media timing and decoding behavior?
- Do PASS_TO_PASS checks reject collateral damage?
- Are all fixtures redistributable and free of hidden network dependence?
- Does the reference human editor pass?
- Do at least two independent reviewers agree that the oracle is valid?

Cases that fail review should be removed, not compensated for with judge prose.

## Recommended first research release

Do not begin with open-ended feature-film quality. Begin with three layers:

1. **Exact-edit core** — 30–50 synthetic/licensed tasks covering trim, order,
   caption, crop, speed, freeze, audio mix, and delivery constraints.
2. **Compositional core** — 20–30 tasks combining three to six independent
   requirements plus preservation checks.
3. **Narrative pilot** — 10–20 source/brief pairs with three professional
   references and blinded human evaluation.

Run each exact/compositional case through:

- a deterministic reference implementation;
- an FFmpeg-capable coding agent;
- a Clash-capable agent;
- a no-op baseline;
- a deliberately over-editing baseline; and
- a wrong-source but visually plausible baseline.

Only then should weights, pass thresholds, or a public leaderboard be frozen.
