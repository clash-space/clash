# Search log and correction record

Last reviewed: 2026-08-14 (Asia/Shanghai).

## Why the 2026 VEBENCH paper was initially missed

The initial search was wrong in method, not merely unlucky:

1. It anchored on the older `VEBench` / `VEScore` paper and treated the acronym
   as an identity.
2. It searched “video editing evaluation” as one field instead of separating NLE
   execution, narrative selection, editing understanding, and generative edit
   quality.
3. It did not immediately resolve every acronym to exact title, year, venue,
   task input/output, and official release.
4. It relied on search-result similarity instead of checking the specific paper
   URL supplied by the user.
5. It did not record negative release facts such as “project page currently
   404” or “benchmark data still TODO.”

This produced an avoidable conflation among `VE-Bench`, `VEBench`, `VEBENCH`,
`IVEBench`, and `VBench`.

## Revised search procedure

For every candidate work:

1. Record exact title, punctuation, year, and venue/status.
2. Read the paper abstract and task-definition/evaluation sections.
3. Classify the task by capability layer:
   - NLE execution;
   - narrative/source-interval selection;
   - editing understanding/reasoning;
   - generative edit quality;
   - agent/evaluation infrastructure.
4. Record the actual model input and required output.
5. Record metrics and whether truth is executable, reference-based, human, or a
   learned judge.
6. Check the official repository, dataset, evaluator checkpoint, and license.
7. Record unavailable or promised artifacts as unavailable; do not infer release
   from the paper's future tense.
8. Record the review date because 2026 repositories are changing quickly.

## Search layers used

### Direct NLE agents and tool execution

Queries included combinations of:

- `natural language non-linear video editing benchmark agent`;
- `video editing agent benchmark timeline tools render`;
- `FFmpeg natural language benchmark execution`;
- `music grounded nonlinear video editing benchmark`; and
- `long-form video editing agent trace benchmark`.

Results reviewed: MEDit-Bench, EditDuet, ELLMPEG, GLANCE/MVEBench, VideoAgent,
Crayotter, VideoAdAgent Bench, OSWorld, GUIDE, and VEAC.

### Editing understanding and operation reasoning

Queries included:

- exact `arXiv:2605.03276`;
- `video editing operation simulation benchmark`;
- `video editing technique recognition benchmark`;
- `multi-video reasoning editing benchmark`; and
- `video editing understanding benchmark`.

Results reviewed: VEBENCH 2026, VEU-Bench, GUIDE, ShotBench, and EditVid-QA.

### Generative editing metrics and judges

Queries included exact-title and official-repository searches for:

- VE-Bench;
- VEBench / VEScore;
- IVEBench;
- VEFX-Bench / VEFX-Reward;
- TDVE-Assessor;
- FiVE-Bench;
- CoVEBench;
- OmniEdit-Bench; and
- Aurora / AgentEdit-Bench.

### Evaluation-process standards

Primary sources reviewed:

- [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/);
- [OSWorld](https://github.com/xlang-ai/OSWorld);
- [Inspect AI](https://inspect.aisi.org.uk/); and
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/).

## Time-sensitive release checks

These observations are facts only for the review date:

- `https://vebench.github.io/`, linked by the VEBENCH 2026 paper, returned HTTP
  404 on 2026-08-14. The paper itself was available.
- The [MEDit-Bench project page](https://ogatakatsuya.github.io/medit-bench/)
  returned HTTP 200 and linked `kattyan/MEDit-Bench` on Hugging Face.
- The [GLANCE repository](https://github.com/ZihaoLinQZ/GLANCE-Video-Editing-Agent)
  contained one README and stated “Code will be released soon.”
- The [Aurora repository](https://github.com/yeates/Aurora) exposed inference,
  weights, and evaluation code but listed AgentEdit-Bench data as TODO.
- The [VEFX-Bench repository](https://github.com/Visko-Platform/VEFX-Bench)
  exposed code plus released 4B and 32B evaluator checkpoints under
  Apache-2.0.
- The [VE-Bench repository](https://github.com/littlespray/VE-Bench) exposed an
  installable evaluator and links to its database/checkpoints.
- The [OmniEdit-Bench dataset](https://huggingface.co/datasets/OmniEdit-Bench/OmniEdit-Bench)
  described 790 tasks and a Gemini-based evaluation script. Its default script
  skips missing outputs, which a rigorous comparative runner should instead
  count explicitly as failures or report as missing coverage.

## Uncertainties retained deliberately

- No public, reusable EditDuet benchmark package or redistributable EditStock
  fixture corpus was confirmed. The paper is the source of truth for its setup.
- ELLMPEG's paper describes the 480-query dataset and execution protocol; an
  official public benchmark repository was not confirmed in this review.
- VideoAgent's code and paper are public, but its broad service dependencies and
  demonstration media make it unsuitable as a drop-in neutral benchmark.
- New 2026 repositories may release code or data after this review. Release
  status must be rechecked before implementation dependencies are selected.

## Primary references

- MEDit-Bench: https://arxiv.org/abs/2607.25300
- EditDuet: https://arxiv.org/abs/2509.10761
- VEBENCH 2026: https://arxiv.org/abs/2605.03276
- VE-Bench: https://arxiv.org/abs/2408.11481
- VEBench / VEScore: https://openreview.net/forum?id=nZNWrzDBHG
- IVEBench: https://arxiv.org/abs/2510.11647
- VEFX-Bench: https://arxiv.org/abs/2604.16272
- TDVE-Assessor: https://github.com/JuntongWang/TDVE-Assessor
- FiVE-Bench: https://openaccess.thecvf.com/content/ICCV2025/html/Li_FiVE-Bench_A_Fine-grained_Video_Editing_Benchmark_for_Evaluating_Emerging_Diffusion_ICCV_2025_paper.html
- CoVEBench: https://arxiv.org/abs/2606.08415
- OmniEdit-Bench: https://arxiv.org/abs/2608.05049
- ELLMPEG: https://arxiv.org/abs/2602.00028
- GLANCE / MVEBench: https://arxiv.org/abs/2604.05076
- VideoAgent: https://arxiv.org/abs/2606.23327
- Crayotter: https://arxiv.org/abs/2606.07636
- GUIDE: https://guide-bench.github.io/
- OSWorld: https://arxiv.org/abs/2404.07972
- Inspect AI: https://inspect.aisi.org.uk/
- OpenTelemetry semantic conventions: https://opentelemetry.io/docs/specs/semconv/
- SWE-bench Verified: https://openai.com/index/introducing-swe-bench-verified/
