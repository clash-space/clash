import type {
  AgentEvidenceRequirements,
  RequiredProductState,
} from "./evidence.js";

export interface AgentDemoDriver {
  kind: "agent";
  projectName: string;
  prompt: string;
  requirements: AgentEvidenceRequirements;
  expectedFinalAnswer?: string;
}

export interface AgentDemoDriverModule {
  default: AgentDemoDriver;
}

export type FeatureDemoStep =
  | { kind: "create-timeline"; name: string }
  | { kind: "create-director-stage"; name: string }
  | { kind: "open-main-canvas" };

export interface FeatureDemoDriver {
  kind: "feature";
  projectName: string;
  steps: FeatureDemoStep[];
  minimumProductState: {
    canvasNodes: number;
    timelines: number;
    directorStages: number;
  };
  requiredProductState: RequiredProductState;
}

export type DemoDriver = AgentDemoDriver | FeatureDemoDriver;

export interface DemoDriverModule {
  default: DemoDriver;
}
