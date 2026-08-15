# Instruction-following video-editing benchmark research

Status: research record, not an implemented suite or frozen scoring contract.

Last reviewed: 2026-08-14.

## Conclusion

A benchmark built from a natural-language editing brief, an initialized editing
environment, an agent trajectory, a modified environment, and executable
postconditions is scientifically defensible. No existing public benchmark found
in this review combines all of those pieces for non-linear video editing (NLE).

The closest precedents each cover a different slice:

- [MEDit-Bench](https://arxiv.org/abs/2607.25300) provides the strongest
  precedent for message-conditioned cut selection, multiple professional
  references, and temporal-alignment metrics.
- [EditDuet](https://arxiv.org/abs/2509.10761) provides the closest published NLE
  agent environment: natural-language requests, searchable footage, a mutable
  timeline, editing tools, rendering, and a human-calibrated judge.
- [ELLMPEG](https://arxiv.org/abs/2602.00028) provides a direct FFmpeg command
  generation and execution baseline over 480 natural-language queries.
- [OSWorld](https://github.com/xlang-ai/OSWorld) provides the mature pattern of
  initialized environments plus execution-based postcondition evaluators.
- [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/)
  provides the useful analogy of real natural-language tasks, human validation,
  containerized execution, and hidden executable checks. It is a software
  engineering benchmark, not a video benchmark.
- [VEFX-Bench](https://github.com/Visko-Platform/VEFX-Bench),
  [VE-Bench](https://github.com/littlespray/VE-Bench), and
  [TDVE-Assessor](https://github.com/JuntongWang/TDVE-Assessor) provide optional
  learned quality evaluators for generative edits, but none is a sufficient
  oracle for NLE task execution.

The recommended design is therefore a new, tool-neutral benchmark with two
separately reported tracks:

1. **Functional instruction following** — detailed briefs with deterministic or
   tolerance-based executable predicates.
2. **Content effect and editorial quality** — multiple valid references,
   professional or human judgments, temporal metrics, and explicitly calibrated
   model judges.

Both tracks should use the same standardized run envelope: immutable initial
Environment, agent/tool configuration, final modified Environment, rendered
artifacts, trusted operation evidence, and an OpenTelemetry-compatible trace.
Clash Workspace remains a product concept contained by the evaluation
Environment; it is not the Environment itself.

## Important naming warning

Do not publish another benchmark under the bare name `VE-Bench`, `VEBench`, or
`VBench`. At least five unrelated works already collide in this namespace:

- `VE-Bench` (AAAI 2025): learned quality assessment for text-driven generative
  editing.
- `VEBench` (2024 OpenReview submission): meta-evaluation of automatic editing
  metrics and the proposed `VEScore`.
- `IVEBench` (ICLR 2026): instruction-guided generative video-editing assessment.
- `VEBENCH` (2026): editing-technique recognition and multi-video operation
  simulation as video QA.
- `VBench` (CVPR 2024): video generation, not video editing.

Use a descriptive working title until the suite scope and public name are
frozen. The directory name `instruction-following-editing` is descriptive, not
a proposed public acronym.

## Research package

- [`landscape.md`](landscape.md) maps the relevant benchmark families and
  distinguishes similarly named works.
- [`methodology.md`](methodology.md) records the proposed scientific evaluation
  contract and how to make it externally credible.
- [`search-log.md`](search-log.md) records search coverage, the earlier miss, and
  time-sensitive release checks.
- [`works.json`](works.json) is a machine-readable index for later suite design.

## Decision boundary

This package deliberately does **not** define cases, weights, a leaderboard
aggregate, or a learned evaluator. Those should be frozen only after:

- representative task construction;
- independent oracle review;
- FFmpeg, Clash, no-op, and adversarial baseline runs;
- held-out human calibration;
- inter-rater and judge-bias analysis; and
- fixture and license review.
