---
name: provider-budget-capability
description: Use when planning provider/model/tool usage, BYO keys, local runtime availability, dry-run costs, max-cost gates, capability checks, and explicit fallback decisions.
---

# Provider Budget Capability

Use this skill before generation-heavy workflows.

Report:

- required providers/runtimes;
- installed/local/remote availability;
- BYO key or OAuth requirements;
- estimated cost and time;
- missing models/tools;
- fallback options and their quality tradeoffs.

Rules:

- `--max-cost 0` should produce a plan but block paid generation.
- Missing local runtime must not silently become cloud runtime.
- Provider/model fallback needs an explicit decision log.

## Clash Managed Dry Run

For managed local execution, write a readable request file:

```json
{
  "workflowId": "short-drama-episode-001",
  "stage": "generate",
  "maxCostUsd": 0,
  "operations": [
    {
      "id": "character-three-view",
      "capability": "image.generation",
      "provider": "local-comfyui",
      "runtime": "comfyui",
      "mode": "local",
      "availability": "available",
      "estimatedCostUsd": 0,
      "estimatedSeconds": 90,
      "requiresByoKey": false
    }
  ],
  "fallbackOptions": []
}
```

Then ask Clash to write the gate artifact:

```bash
clash production plan-dry-run-cost-gate \
  --request plans/generate.dry-run-request.json \
  --out reviews/gates/generate.dry-run-cost-gate.json \
  --json
```

The result uses `kind: "clash.workflow.dry-run-cost-gate"` and records
availability, estimated cost/time, max-cost blocking, rejected fallback options,
`fallbackUsed: false`, and `executionAllowed`. This command must not execute
generation, download, render, or provider calls.
