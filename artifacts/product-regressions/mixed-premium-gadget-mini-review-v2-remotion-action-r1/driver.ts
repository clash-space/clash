import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const workspace = resolve(process.env.CLASH_REGRESSION_WORKSPACE ?? "");
const sourceWorkspace = resolve(process.env.CLASH_REGRESSION_SOURCE_WORKSPACE ?? "");
const cli = resolve(process.env.CLASH_REGRESSION_CLI ?? "");
const eventPath = resolve(process.env.CLASH_REGRESSION_DRIVER_EVENTS ?? join(workspace, "driver-events.jsonl"));

if (!workspace || !sourceWorkspace || !cli) {
  throw new Error(
    "CLASH_REGRESSION_WORKSPACE, CLASH_REGRESSION_SOURCE_WORKSPACE, and CLASH_REGRESSION_CLI are required",
  );
}

const stageId = "mixed-premium-gadget-mini-review-v2-stage";
const timelineId = "mixed-premium-gadget-mini-review-v2-timeline";
const deliverables = join(workspace, "deliverables");
const components = join(workspace, "components");
mkdirSync(deliverables, { recursive: true });
mkdirSync(components, { recursive: true });

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function printableArg(argument: string): string {
  return Buffer.byteLength(argument) > 512
    ? `<arg:${Buffer.byteLength(argument)}B sha256:${sha256(argument)}>`
    : argument;
}

function invoke(args: string[], timeout = 120_000): JsonRecord {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  const event = {
    startedAt,
    finishedAt: new Date().toISOString(),
    argv: args.map(printableArg),
    exitCode: result.status,
    signal: result.signal,
    stdoutSha256: sha256(result.stdout ?? ""),
    stderrSha256: sha256(result.stderr ?? ""),
  };
  writeFileSync(eventPath, `${JSON.stringify(event)}\n`, { flag: "a" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `clash ${args.map(printableArg).join(" ")} failed: ${
        result.error?.message ?? result.stderr ?? result.stdout
      }`,
    );
  }
  const text = result.stdout.trim();
  return text ? (JSON.parse(text) as JsonRecord) : {};
}

const sourceStagePath = join(sourceWorkspace, "deliverables", "stage.json");
const sourceTimelinePath = join(sourceWorkspace, "deliverables", "timeline.yaml");
const sourceComponentPath = join(
  sourceWorkspace,
  "components",
  "mixed-premium-gadget-mini-review-v2-character.tsx",
);
const componentPath = join(
  components,
  "mixed-premium-gadget-mini-review-v2-character.tsx",
);
copyFileSync(sourceComponentPath, componentPath);

const authoredStage = JSON.parse(readFileSync(sourceStagePath, "utf8")) as JsonRecord;
authoredStage.shots = [];
const stageDraftPath = join(deliverables, "stage-draft.json");
writeFileSync(stageDraftPath, `${JSON.stringify(authoredStage, null, 2)}\n`);

invoke(["director", "create", "--id", stageId, "--name", "Obsidian Arc Product Stage", "--json"]);
const initialStage = invoke([
  "director",
  "pull",
  "--stage",
  stageId,
  "--file",
  "deliverables/stage-base.json",
  "--json",
]);
invoke([
  "director",
  "apply",
  "--stage",
  stageId,
  "--file",
  "deliverables/stage-draft.json",
  "--base-revision",
  String(initialStage.revisionId),
  "--json",
]);

const captureArgs = [
  "director",
  "capture",
  "--stage",
  stageId,
  "--time",
  "0.8",
  "--label",
  "orbit-opening",
  "--time",
  "4.5",
  "--label",
  "sensor-turn",
  "--time",
  "8.2",
  "--label",
  "hero-closing",
  "--aspect-ratio",
  "1:1",
  "--long-edge",
  "1080",
  "--json",
];
const initialCapture = invoke([
  ...captureArgs,
  "--output-dir",
  "deliverables/director-captures-initial",
], 300_000) as JsonRecord & {
  sourceStageRevisionId: string;
  frames: Array<{ artifactId: string; projectAssetId?: string }>;
};
const captureByLabel = new Map(initialCapture.frames.map((frame) => [frame.artifactId, frame]));
for (const label of ["orbit-opening", "sensor-turn", "hero-closing"]) {
  if (!captureByLabel.get(label)?.projectAssetId) {
    throw new Error(`Director capture ${label} has no Project Asset id`);
  }
}

authoredStage.shots = [
  {
    id: "orbit-opening",
    name: "Opening silhouette",
    cameraId: "camera-orbit",
    assetId: captureByLabel.get("orbit-opening")!.projectAssetId,
    aspectRatio: "1:1",
    stageRevisionId: initialCapture.sourceStageRevisionId,
    createdAt: "2026-08-15T00:00:00.000Z",
    timeSeconds: 0.8,
  },
  {
    id: "sensor-turn",
    name: "Precision sensor turn",
    cameraId: "camera-detail",
    assetId: captureByLabel.get("sensor-turn")!.projectAssetId,
    aspectRatio: "1:1",
    stageRevisionId: initialCapture.sourceStageRevisionId,
    createdAt: "2026-08-15T00:00:00.000Z",
    timeSeconds: 4.5,
  },
  {
    id: "hero-closing",
    name: "Closing hero lockup",
    cameraId: "camera-orbit",
    assetId: captureByLabel.get("hero-closing")!.projectAssetId,
    aspectRatio: "1:1",
    stageRevisionId: initialCapture.sourceStageRevisionId,
    createdAt: "2026-08-15T00:00:00.000Z",
    timeSeconds: 8.2,
  },
];
writeFileSync(stageDraftPath, `${JSON.stringify(authoredStage, null, 2)}\n`);
invoke([
  "director",
  "apply",
  "--stage",
  stageId,
  "--file",
  "deliverables/stage-draft.json",
  "--base-revision",
  initialCapture.sourceStageRevisionId,
  "--json",
]);
const finalStage = invoke([
  "director",
  "pull",
  "--stage",
  stageId,
  "--file",
  "deliverables/stage.json",
  "--json",
]);
const finalCapture = invoke([
  ...captureArgs,
  "--output-dir",
  "deliverables/director-captures-final",
], 300_000) as JsonRecord & {
  sourceStageRevisionId: string;
  frames: Array<{ artifactId: string; projectAssetId?: string; sha256: string }>;
};
if (finalCapture.sourceStageRevisionId !== finalStage.revisionId) {
  throw new Error("Final Director capture did not target the persisted final Stage revision");
}
for (const frame of finalCapture.frames) {
  if (frame.projectAssetId !== captureByLabel.get(frame.artifactId)?.projectAssetId) {
    throw new Error(`Final Director capture changed Project Asset identity for ${frame.artifactId}`);
  }
}

const componentSource = readFileSync(componentPath, "utf8");
const canvasAdd = invoke([
  "canvas",
  "add",
  "--type",
  "remotion",
  "--label",
  "Pulse Metric Presenter",
  "--content",
  componentSource,
  "--json",
]);
const componentNodeId = String(canvasAdd.node_id ?? "");
if (!componentNodeId) throw new Error("Canvas add did not return a node id");
const componentNode = invoke(["canvas", "get", "--node", componentNodeId, "--json"]);
if (componentNode.id !== componentNodeId || componentNode.type !== "remotion-component") {
  throw new Error("Canvas readback did not return the persisted Remotion component");
}

invoke(["timeline", "create", "--id", timelineId, "--name", "Obsidian Arc Mini Review", "--json"]);
const initialTimeline = invoke([
  "timeline",
  "pull",
  "--timeline",
  timelineId,
  "--file",
  "deliverables/timeline-base.yaml",
  "--json",
]);
let timelineYaml = readFileSync(sourceTimelinePath, "utf8");
timelineYaml = timelineYaml
  .replaceAll("195cf2f8", componentNodeId)
  .replaceAll(
    "director-capture:bffe6b9f8b874e2fe24e2b97a7f17360",
    captureByLabel.get("orbit-opening")!.projectAssetId!,
  )
  .replaceAll(
    "director-capture:d58f6af15ae888244f500daf9bce61a4",
    captureByLabel.get("sensor-turn")!.projectAssetId!,
  )
  .replaceAll(
    "director-capture:6ef6bfaaffb2c8279deaf11e7322a1d9",
    captureByLabel.get("hero-closing")!.projectAssetId!,
  );
writeFileSync(join(deliverables, "timeline.yaml"), timelineYaml);
invoke(["timeline", "validate", "--file", "deliverables/timeline.yaml", "--json"]);
invoke([
  "timeline",
  "apply",
  "--timeline",
  timelineId,
  "--file",
  "deliverables/timeline.yaml",
  "--base-revision",
  String(initialTimeline.revisionId),
  "--json",
]);
const finalTimeline = invoke([
  "timeline",
  "pull",
  "--timeline",
  timelineId,
  "--file",
  "deliverables/timeline.yaml",
  "--json",
]);
const render = invoke(
  ["timeline", "render", "--timeline", timelineId, "--timeout-ms", "1200000", "--json"],
  1_250_000,
) as JsonRecord & {
  completed?: boolean;
  status?: string;
  sourceTimelineRevisionId?: string;
  renderNodeId?: string;
  target?: { kind?: string };
  asset?: {
    id?: string;
    kind?: string;
    status?: string;
    provenance?: { actionRunId?: string; model?: string };
  };
};
if (
  render.completed !== true ||
  render.status !== "completed" ||
  render.sourceTimelineRevisionId !== finalTimeline.revisionId ||
  render.target?.kind !== "project-assets" ||
  render.asset?.kind !== "video" ||
  render.asset?.status !== "ready" ||
  !render.asset.id?.startsWith("plugin-output:") ||
  render.asset.provenance?.model !== "remotion-render" ||
  !render.asset.provenance.actionRunId?.startsWith("timeline-render:")
) {
  throw new Error(`Timeline Action render did not complete: ${JSON.stringify(render)}`);
}

invoke(["assets", "get", "--asset", render.asset.id, "--json"]);
invoke([
  "assets",
  "link",
  "--asset",
  render.asset.id,
  "--name",
  "mixed-premium-gadget-mini-review-v2-final.mp4",
  "--json",
]);
const finalVideoPath = join(deliverables, "mixed-premium-gadget-mini-review-v2-final.mp4");
copyFileSync(
  join(workspace, "assets", "links", "mixed-premium-gadget-mini-review-v2-final.mp4"),
  finalVideoPath,
);

for (const [name, seconds] of [
  ["frame-opening", "0.8"],
  ["frame-mg-action", "4.5"],
  ["frame-closing", "8.2"],
] as const) {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-ss", seconds, "-i", finalVideoPath, "-frames:v", "1", join(deliverables, `${name}.png`)],
    { cwd: workspace, encoding: "utf8", timeout: 120_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg sample ${name} failed: ${result.error?.message ?? result.stderr}`);
  }
}

const report = `# Deterministic product-path regression\n\nThis is not a Codex or model attempt. It replays the public Clash CLI path for benchmark case \`${stageId.replace("-stage", "")}\` against a fresh import of the declared base Workspace.\n\n- Director Stage: \`${stageId}\` @ \`${finalStage.revisionId}\`\n- Final exact-replay capture: \`${finalCapture.sourceStageRevisionId}\`\n- Remotion component Canvas node: \`${componentNodeId}\`\n- Timeline: \`${timelineId}\` @ \`${finalTimeline.revisionId}\`\n- Product output destination: \`${render.target.kind}\`\n- Bundled Action evidence: Project Asset id \`${render.asset.id}\`, model \`${render.asset.provenance.model}\`, run \`${render.asset.provenance.actionRunId}\`\n- Render node: \`${render.renderNodeId}\`\n- Final MP4 SHA-256: \`${sha256(readFileSync(finalVideoPath))}\`\n\nThe same Director capture Project Asset IDs are persisted in the Stage shots and Timeline image items. The final Stage was recaptured at the same labels and exact times after those references were persisted.\n`;
writeFileSync(join(deliverables, "lineage-report.md"), report);

writeFileSync(
  join(workspace, "submission.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      taskId: "mixed-premium-gadget-mini-review-v2",
      artifacts: [
        { id: "stage", kind: "director-stage", path: "deliverables/stage.json" },
        {
          id: "director-capture-frame",
          kind: "image",
          path: "deliverables/director-captures-final/sensor-turn.png",
        },
        { id: "timeline", kind: "timeline", path: "deliverables/timeline.yaml" },
        {
          id: "component-source",
          kind: "remotion-component",
          path: "components/mixed-premium-gadget-mini-review-v2-character.tsx",
        },
        {
          id: "final-video",
          kind: "video",
          path: "deliverables/mixed-premium-gadget-mini-review-v2-final.mp4",
        },
        { id: "frame-opening", kind: "image", path: "deliverables/frame-opening.png" },
        { id: "frame-mg-action", kind: "image", path: "deliverables/frame-mg-action.png" },
        { id: "frame-closing", kind: "image", path: "deliverables/frame-closing.png" },
        { id: "lineage-report", kind: "report", path: "deliverables/lineage-report.md" },
      ],
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(workspace, "product-regression-result.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "deterministic-product-regression",
      benchmarkCaseId: "mixed-premium-gadget-mini-review-v2",
      realAgentAttempt: false,
      adapter: "none",
      projectId: "benchmark-content-effect-base-v1",
      stageId,
      stageRevisionId: finalStage.revisionId,
      componentNodeId,
      timelineId,
      timelineRevisionId: finalTimeline.revisionId,
      renderNodeId: render.renderNodeId,
      renderTarget: render.target,
      projectAssetId: render.asset.id,
      finalVideo: {
        path: "deliverables/mixed-premium-gadget-mini-review-v2-final.mp4",
        sha256: sha256(readFileSync(finalVideoPath)),
      },
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`${JSON.stringify(render)}\n`);
