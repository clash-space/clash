# Clash Execution Contract

Use Clash as the project-state and collaboration host. Use files for readable
plans and projections; use public CLI operations for Project, Canvas, Asset, and
Timeline state.

## 1. Resolve the Project

Inspect before mutation:

```bash
clash host status --json
clash projects list --json
clash canvases list --project <project-id> --json
clash timeline list --project <project-id> --json
```

If a Project already matches the job, reuse it. Project creation is persistent;
create one only when the user requested a new production or no suitable Project
exists. Link the working directory once:

```bash
clash init --project <project-id> --json
clash canvas connect --project <project-id>
```

## 2. Create Draft Canvases

For a small job, create one draft Canvas:

```bash
clash canvases create --project <project-id> --id drafts --name "Drafts" --json
```

For a larger production, create a development Canvas plus sequence Canvases:

```bash
clash canvases create --project <project-id> --id development --name "Development" --json
clash canvases create --project <project-id> --id sequence-01 --name "Sequence 01" --json
clash canvases create --project <project-id> --id sequence-02 --name "Sequence 02" --json
```

Every Canvas node command must identify its Canvas with `--canvas <canvas-id>`.
The default `main` Canvas is not a safe implicit target in a multi-Canvas run.
Canvas organization is draft state; it is allowed to be exploratory and
branchy. Only selected assets should cross the editorial boundary into the
Timeline.

## 3. Build Creative Context and Generation Nodes

Use Groups as visible generation paths and text nodes for inspectable context:

```bash
clash canvas add --project <project-id> --canvas development \
  --type text --label "Creative Contract" --content "<contract>" --json

clash canvas add --project <project-id> --canvas sequence-01 \
  --type group --label "Path / Shot 03 — Product Reveal + Coverage" --json
```

Keep the Group path readable: inputs and references first, generation
hypotheses next, candidate outputs after them, and a select note last. The Group
is a draft container, not a Timeline sequence.

Keep the storyboard/keyframe, primary action, and coverage candidates in this
same Group so the Agent can reason about them together. Use explicit prompts for
generation nodes. Reference inputs are graph edges and must resolve to asset
nodes on the selected Canvas:

```bash
clash canvas add --project <project-id> --canvas sequence-01 \
  --type video_gen --label "shot-03 / coverage / macro-track" \
  --prompt "<shot-specific prompt>" \
  --model veo-3.1-fast \
  --ref <reference-node-id> \
  --param aspectRatio=16:9 \
  --parent <group-id> --json
```

Do not assume a style reference generated on another Canvas can be passed
directly as `--ref`. Current CLI reference edges are Canvas-local. Until the
host exposes a public cross-Canvas placement command, either generate dependent
work on the Canvas that contains the locked reference, use a supported shared
Project asset placement in the UI, or record the limitation as a system gap.
Do not duplicate blobs or reach into private state to fake a placement.

## 4. Generate Candidate Batches

Create one action node per named candidate hypothesis when independent outputs
and lineage matter. Execute all candidate nodes before waiting:

```bash
clash canvas execute --project <project-id> --node <candidate-a-node> --json
clash canvas execute --project <project-id> --node <candidate-b-node> --json
clash canvas execute --project <project-id> --node <candidate-c-node> --json
```

Capture every returned `childNodeId`. Observe each durable result node until
its product status is `completed` or `failed`:

```bash
clash canvas get --project <project-id> --node <child-node-id> --json
```

After completion, read the source Canvas and capture output node and asset IDs:

```bash
clash canvas list --project <project-id> --json
clash canvas get --project <project-id> --node <output-node-id> --json
```

On failure, read the structured error. Retry once only for a transient upstream
error. Prompt rejection, capability mismatch, budget exhaustion, or repeated
technical defects require a changed plan.

## 5. Apply Safe Revisions

Read a node before a direct update. If it is immutable because downstream work
references it, use copy-on-write:

```bash
clash canvas get --project <project-id> --canvas <canvas-id> --node <node-id> --json
clash canvas copy --project <project-id> --canvas <canvas-id> --node <node-id> --json
```

Do not delete failed or rejected candidates automatically. They are cheap audit
history and may explain a later choice. Delete only when the user asks or
retention policy requires it, after graph-aware review.

## 6. Build the Master Timeline

Create a standalone Timeline unless the edit is deliberately Canvas-owned:

```bash
clash timeline create --project <project-id> --id master-v1 --name "Master v1" --json
clash timeline pull --project <project-id> --timeline master-v1 \
  --file timelines/master-v1.timeline.yaml --json
```

Edit the pulled YAML with normal file tools. A minimal media item pins the
selected Canvas node and Project asset:

```yaml
compositionWidth: 1920
compositionHeight: 1080
fps: 30
durationInFrames: 450
tracks:
  - id: main-video
    name: Main video
    items:
      - id: shot-01
        type: video
        from: start
        durationInFrames: 120
        sourceNodeId: <selected-output-node-id>
        assetId: <selected-asset-id>
      - id: shot-02
        type: video
        from: prev
        durationInFrames: 90
        sourceNodeId: <selected-output-node-id>
        assetId: <selected-asset-id>
```

`from: prev`, `prev+N`, `prev-N`, and `<item-id>+N` make editorial relationships
readable. Use explicit frames when a beat or sync point must remain locked.

Apply only after QA and any required review gate:

```bash
clash timeline apply --project <project-id> --timeline master-v1 \
  --file timelines/master-v1.timeline.yaml --json
```

If apply reports stale state, pull again, merge the current Timeline with the
intended edit, and apply. There is no force flag.

## 7. End the Session

Disconnect after the run or when switching Projects:

```bash
clash canvas disconnect --project <project-id>
```

Report creative outcomes and blockers, not a dump of commands or node JSON.
