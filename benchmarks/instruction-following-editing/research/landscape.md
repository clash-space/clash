# Benchmark landscape

Last reviewed: 2026-08-14.

The term “video editing benchmark” currently covers at least four materially
different problems. Conflating them caused the initial search miss:

1. **NLE execution** — an agent selects, trims, orders, mixes, captions, and
   renders existing media with tools.
2. **Narrative selection** — a model identifies source intervals and their order
   for a message or story.
3. **Editing understanding** — a model recognizes techniques or predicts a
   plausible operation without executing it.
4. **Generative editing quality** — a model changes pixels in a source video and
   is scored for fidelity, instruction following, and visual quality.

Our target is primarily the first category, with the second as a content-effect
track. The third and fourth categories remain useful sources of taxonomies and
secondary evaluators.

## Closest precedents

| Work                                                                | What it actually evaluates                                   | Environment and output                                                                | Ground truth / scoring                                                                                   | What to borrow                                                                                    | Why it is not sufficient alone                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [MEDit-Bench](https://arxiv.org/abs/2607.25300) (2026)              | Message-driven narrative cut selection                       | 60 long videos, three messages per video, cut-only 1–3 minute edits                   | 540 professional edits; temporal R@threshold, cut F1@threshold, mIoU; human study                        | Multiple editors per brief, temporal metrics, ambiguity/contextfulness slices                     | No tool execution, audio, titles, effects, editable project, or trajectory                                                             |
| [EditDuet](https://arxiv.org/abs/2509.10761) (SIGGRAPH 2025)        | Language-driven B-roll assembly in an NLE                    | A-roll transcript, collection summary/search, mutable timeline, editing tools, render | Failure rate, duration coverage, repeated footage, VLM pairwise judge, 35-person study                   | Real editing loop, agent/critic split, validity and structural metrics, human calibration         | Five proprietary EditStock projects; narrow B-roll setting; no reusable public benchmark package confirmed                             |
| [ELLMPEG](https://arxiv.org/abs/2602.00028) (2026)                  | Natural-language generation of FFmpeg and VVenC commands     | Local command generation and execution                                                | 480 queries; command validity, runtime correctness, latency, throughput, energy                          | FFmpeg tool baseline and execution evidence                                                       | Command correctness is narrower than editorial correctness                                                                             |
| [GLANCE / MVEBench](https://arxiv.org/abs/2604.05076) (2026)        | Music-grounded NLE: on-beat and story-driven editing         | Multi-agent system over music and footage                                             | Agent judge over rhythm, emotion, instruction following, story completeness, continuity, overall quality | Music and pacing taxonomy; task difficulty by prompt specificity and music length                 | [Official repository](https://github.com/ZihaoLinQZ/GLANCE-Video-Editing-Agent) still said “Code will be released soon” at review time |
| [VideoAgent / VideoEdit](https://arxiv.org/abs/2606.23327) (2026)   | Broad multimodal editing/remaking and workflow orchestration | More than 30 specialized agents and graph workflows                                   | Workflow success, retrieval ordering/IoU/alignment, human ratings                                        | Operation taxonomy and complex workflow baselines                                                 | Large coupled service/model stack; not a clean tool-neutral benchmark; demo media has unclear reuse suitability                        |
| [Crayotter](https://arxiv.org/abs/2606.07636) (2026)                | Traceable long-form prompt-to-video production               | Planning, research artifacts, tool calls, scheduler events, renders, final export     | Human evaluation across 23 themes; reported overall 3.40/5                                               | First-class plans, artifacts, checkpoints, traces, and repairability                              | System evaluation rather than a standardized independent benchmark                                                                     |
| [VideoAdAgent Bench](https://github.com/creatify-ai/VABench) (2026) | End-to-end finished video advertisements                     | Structured production brief to MP4                                                    | Pairwise judges, deterministic duration/aspect/audio/OCR checks, defect judge, cost and latency          | Pre-registered briefs; deterministic production checks; position-swapped judges; fictional brands | Vendor-authored benchmark led by the evaluated product; domain-specific and not independent validation                                 |
| [OSWorld](https://github.com/xlang-ai/OSWorld) (NeurIPS 2024)       | General computer-use agents in real applications             | Resettable VM, agent actions, final application state                                 | Execution-based postconditions and verified public evaluation                                            | Environment setup/reset, evaluator scripts, trajectories, verified runs                           | Video editing is only incidental and tool compliance can differ from artifact correctness                                              |

## MEDit-Bench: strongest narrative oracle precedent

[MEDit-Bench](https://arxiv.org/abs/2607.25300) is the closest answer to “can a
natural-language editing description be scored programmatically?” Its dataset
pairs 60 source videos of 7–18 minutes with three distinct editing messages per
video. Three professional editors independently create a cut-only edit for every
video-message pair, yielding 540 edits. Editors may reorder shots, target a
1–3-minute result, and ignore audio.

The benchmark reports temporal alignment rather than exact encoded-video
identity:

- union-mask coverage / mIoU;
- temporal recall at multiple IoU thresholds;
- optimal cut matching and F1 at multiple IoU thresholds; and
- leave-one-editor-out human reference performance.

This is important evidence that there need not be one canonical MP4. A brief can
have multiple valid timelines, and a prediction can be scored by properties of
its selected source intervals. MEDit-Bench also labels message ambiguity and
contextfulness, both of which correlate negatively with performance.

It also supplies a direct warning: the paper found severe position bias in its
LLM pairwise judge and concluded that the judge was unreliable for narrative
quality. Commercial judge versions may change silently, creating an additional
reproducibility problem. The benchmark therefore supports using model judges as
calibrated secondary measurements, not primary truth.

The [project page](https://ogatakatsuya.github.io/medit-bench/) linked a public
[Hugging Face dataset](https://huggingface.co/datasets/kattyan/MEDit-Bench) at
review time.

## EditDuet: closest agent + NLE environment precedent

[EditDuet](https://arxiv.org/abs/2509.10761) frames NLE as sequential decision
making. Its environment exposes:

- an A-roll transcript;
- a summary of the available video collection;
- text-to-visual segment search; and
- the current NLE timeline.

The editor agent can search and mutate the timeline while a critic either gives
feedback or requests rendering. Its structural measurements are directly useful:

- **failure rate**: a run does not produce a valid render;
- **time coverage**: `min(target, actual) / max(target, actual)`;
- **repetitions**: selected sub-clips with at least 80% overlap; and
- **preference**: a pairwise visual judge plus a blinded human study.

The paper reports judge–human agreement of 80.6%, human–human agreement of
78.7%, and PABAK of 0.61 versus 0.57. This is an example of how a domain judge
can become evidence: the authors measured it against held-out human preference
instead of merely asserting that the rubric looked reasonable. It does not mean
the judge transfers automatically to other editing distributions.

All thumbnails in the paper are identified as copyrighted EditStock material,
and the evaluation uses five real-world EditStock projects. That makes it a
conceptual precedent rather than an immediately reusable fixture corpus.

## The 2026 VEBENCH baseline environment

The paper at [arXiv:2605.03276](https://arxiv.org/abs/2605.03276) is
`VEBENCH: Benchmarking Large Multimodal Models for Real-World Video Editing`.
Despite “operation simulation” in the name, its baseline environment is a closed
video-QA protocol, not a shell, FFmpeg process, NLE timeline, Workspace, render
loop, or agent trajectory.

It contains two tasks:

### TechRec

The model watches an already edited video and identifies one of seven techniques
at an editing point: L-cut, J-cut, jump cut, smash cut, cutaway, match cut, or
invisible cut. Evaluation is standard multiple-choice accuracy.

### OpSim

The model receives one pre-cut reference clip and multiple candidate videos. It
must choose the candidate, select its start and end timestamps, and say whether
it belongs before or after the reference clip. The benchmark separately reports
footage-selection accuracy and candidate-conditional temporal IoU: a wrong
candidate receives zero temporal score.

For models without native multi-video input, all clips are concatenated into one
video with persistent on-screen labels separating reference and candidate clips.
Frame sampling follows each model's default. The paper evaluates proprietary and
open models including GPT-4o, Gemini-2.5-Pro, Qwen3-VL variants, Qwen2.5-VL, and
InternVL3 variants, with subtitle/no-subtitle conditions for OpSim.

The paper reports 3.9K edited videos, more than 257 hours, and 3,080
human-verified QA pairs. It is valuable for editing-technique knowledge,
multi-video footage choice, and temporal localization. It does **not** test
whether an agent can operate an editor or produce a valid editable project. The
paper-linked project URL `https://vebench.github.io/` returned HTTP 404 during
the 2026-08-14 release check, so code/data availability should be rechecked
before depending on it.

## Similar names that are different benchmarks

| Name              | Paper / release                                                                                               | Scope                                                                                                                                  | Relationship                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| VE-Bench          | [AAAI 2025 paper](https://arxiv.org/abs/2408.11481), [official code](https://github.com/littlespray/VE-Bench) | Human-aligned quality assessment for text-driven generative edits; 8 methods, 24 participants, 28,080 ratings; released `VEBenchModel` | Independent work; not VEBENCH 2026 and not IVEBench                                                  |
| VEBench + VEScore | [OpenReview](https://openreview.net/forum?id=nZNWrzDBHG)                                                      | Meta-evaluates automatic metrics over 152 clips, 962 prompts, and 1,280 outputs from 8 models; proposes an MLLM evaluator              | Independent work; code/data promised upon acceptance in the reviewed version                         |
| IVEBench          | [ICLR 2026 paper](https://arxiv.org/abs/2510.11647), [official code](https://github.com/RyanChenYN/IVEBench)  | 600 sources, 8 task categories / 35 subcategories, 32–1,024 frames; quality, instruction compliance, fidelity                          | Independent generative-edit benchmark; no direct organizational relationship to either VEBench found |
| VEBENCH           | [2026 paper](https://arxiv.org/abs/2605.03276)                                                                | Editing-technique recognition and multi-video operation-simulation QA                                                                  | Understanding/reasoning benchmark, not output-quality benchmark                                      |
| VBench            | [CVPR 2024 code](https://github.com/Vchitect/VBench)                                                          | Video generation quality across 16 dimensions                                                                                          | No `E`; not an editing execution benchmark                                                           |

## Generative edit evaluators and taxonomies

These works are relevant to a secondary content-quality scorer. Their training
distribution is generative video-to-video editing, so they cannot establish that
a timeline contains the right source intervals, captions, audio edits, or
editable state.

### VEFX-Bench / VEFX-Reward

[VEFX-Bench](https://arxiv.org/abs/2604.16272) has 5,049 annotated examples from
1,419 source videos across 9 categories / 32 subcategories and a 300-pair test
set. Its released [4B and 32B reward models](https://github.com/Visko-Platform/VEFX-Bench)
score 1–4 on:

- instruction following;
- render quality; and
- edit exclusivity, meaning whether unrelated content changed.

Edit exclusivity is especially relevant to no-regression checks. The repository
is Apache-2.0 and exposes a source-video / edited-video / instruction scoring
API. Treat it as a baseline evaluator, not ground truth.

### VE-Bench QA and TDVE-Assessor

[VE-Bench QA](https://github.com/littlespray/VE-Bench) is an officially released
learned metric taking prompt, source video, and edited video. Its normalized
output is explicitly not a literal 1–10 human score.

[TDVE-Assessor](https://github.com/JuntongWang/TDVE-Assessor) reports 3,857
edited videos from 12 models and 173,565 human ratings. It predicts edited-video
quality, editing alignment, and structural consistency. It is useful as another
external baseline and calibration target, not as a universal NLE judge.

### IVEBench, FiVE-Bench, CoVEBench, and OmniEdit-Bench

- [IVEBench](https://arxiv.org/abs/2510.11647) contributes broad source/task
  diversity and three-dimensional evaluation.
- [FiVE-Bench](https://openaccess.thecvf.com/content/ICCV2025/html/Li_FiVE-Bench_A_Fine-grained_Video_Editing_Benchmark_for_Evaluating_Emerging_Diffusion_ICCV_2025_paper.html)
  contributes 100 videos, 420 object-level prompt pairs, masks, six edit types,
  and 15 preservation/alignment/quality metrics.
- [CoVEBench](https://arxiv.org/abs/2606.08415) contributes 626 compositional
  instructions and 9,990 fine-grained checklist items. Its finding that models
  omit requested edits and violate preservation constraints supports explicit
  per-requirement checks.
- [OmniEdit-Bench](https://arxiv.org/abs/2608.05049) contributes five tracks —
  spatial, temporal, reasoning, audio, and reference — and separates accuracy,
  preservation, realism, and consistency. Its public dataset describes 790
  tasks. Its accuracy-aware penalty is a strong precedent for preventing a
  pretty but instructionally wrong output from scoring well.

### Aurora / AgentEdit-Bench

[Aurora](https://github.com/yeates/Aurora) is a tool-using planner around a
generative editor and introduces AgentEdit-Bench for retrieval-conditioned and
reasoning edits. At review time, inference code, weights, and evaluation code
were available, while the repository still marked the AgentEdit-Bench data as
TODO. It is therefore a system/evaluator reference, not yet a dependency for a
reproducible suite.

## Editing understanding and human workflow datasets

These are useful for category coverage but do not score final execution.

- [VEU-Bench](https://arxiv.org/abs/2504.17828) covers 19 recognition, reasoning,
  and judging tasks for editing components.
- [GUIDE](https://guide-bench.github.io/) contains 67.5 hours of screen
  recordings from 120 novice users in 10 applications. Premiere Pro and CapCut
  tasks are included, but its targets are behavior-state detection, intent
  prediction, and help prediction.
- [The Anatomy of Video Editing](https://github.com/dawitmureja/AVE) offers a
  large taxonomy of cinematographic and editing components for category design.

## Standards and infrastructure precedents

### SWE-bench Verified

[SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/)
is a 500-task human-validated subset of SWE-bench. Professional developers
screened whether issue descriptions were sufficiently specified and whether the
tests were appropriate; the release also provided a containerized harness.

The analogy is methodological: an editing brief corresponds to the issue, the
initialized media project corresponds to the repository, the agent's timeline
and render correspond to the patch, and hidden executable media/project checks
correspond to tests. It supplies no video metrics itself.

### Inspect AI

[Inspect AI](https://inspect.aisi.org.uk/) is a mature evaluation framework with
composable datasets, agents/solvers, tools, scorers, sandbox providers, multiple
scorers, external-agent bridges, and structured logs. Its Task / Solver / Scorer
separation is a good interoperability target even if the Clash runner remains
TypeScript-native.

### OpenTelemetry

[OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
provide a standard envelope for resources, spans, events, attributes, and
status. The benchmark should emit standard OTLP traces and namespace its custom
attributes, while pinning the semantic-convention version because GenAI
conventions and several convention groups remain versioned or unstable.
