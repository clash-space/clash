import type { FeatureDemoDriver } from "../../../../apps/desktop/e2e/recording/types.js";

const driver = {
  kind: "feature",
  projectName: "Workspace Surfaces Demo",
  steps: [
    { kind: "create-timeline", name: "Signal Garden Feature Cut" },
    { kind: "create-director-stage", name: "Signal Garden Feature Stage" },
    { kind: "open-main-canvas" },
  ],
  minimumProductState: {
    canvasNodes: 0,
    timelines: 1,
    directorStages: 1,
  },
  requiredProductState: {
    timelines: [{ name: "Signal Garden Feature Cut" }],
    directorStages: [{ name: "Signal Garden Feature Stage" }],
  },
} satisfies FeatureDemoDriver;

export default driver;
