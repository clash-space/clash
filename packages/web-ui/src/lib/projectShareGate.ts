import type { ProjectStatusActionGate } from "@clash/shared-runtime";

export interface ProjectShareAdmissionInput {
  shareGate: ProjectStatusActionGate | null | undefined;
  runtimePersistence: string;
}

export interface ProjectShareAdmission {
  visible: boolean;
  allowed: boolean;
  tooltip: string;
  source: "project-status" | "runtime-capability-fallback";
}

export interface ProjectWebAdmissionInput {
  openInWebGate: ProjectStatusActionGate | null | undefined;
  webUrl?: string | null;
}

export interface ProjectWebAdmission {
  visible: boolean;
  allowed: boolean;
  tooltip: string;
  url: string | null;
  source: "project-status";
}

export function resolveProjectShareAdmission(input: ProjectShareAdmissionInput): ProjectShareAdmission {
  const shareGate = input.shareGate;
  if (shareGate) {
    return {
      visible: true,
      allowed: shareGate.allowed,
      tooltip: projectShareGateTooltip(shareGate.reason, shareGate.requirements),
      source: "project-status",
    };
  }

  const runtimeAllowsSharing = input.runtimePersistence !== "local";
  return {
    visible: runtimeAllowsSharing,
    allowed: runtimeAllowsSharing,
    tooltip: "Copy project link",
    source: "runtime-capability-fallback",
  };
}

export function resolveProjectWebAdmission(input: ProjectWebAdmissionInput): ProjectWebAdmission {
  const gate = input.openInWebGate;
  const webUrl = input.webUrl?.trim() || null;
  if (gate && !gate.allowed) {
    return {
      visible: true,
      allowed: false,
      tooltip: projectWebGateTooltip(gate.reason, gate.requirements),
      url: null,
      source: "project-status",
    };
  }
  return {
    visible: !!webUrl,
    allowed: !!webUrl,
    tooltip: "Open project in web",
    url: webUrl,
    source: "project-status",
  };
}

function projectShareGateTooltip(
  reason: ProjectStatusActionGate["reason"],
  requirements: ProjectStatusActionGate["requirements"],
): string {
  if (reason === "project-is-local-only") return "Enable sync before sharing this project";
  if (reason === "cloud-sync-not-ready") {
    const labels = projectShareRequirementLabels(requirements);
    const missing = labels.length > 0
      ? `: ${labels.join(", ")}`
      : "";
    return `Finish cloud sync setup before sharing${missing}`;
  }
  if (reason === "sync-mode-unknown") return "Resolve project sync mode before sharing";
  return "Copy project link";
}

function projectWebGateTooltip(
  reason: ProjectStatusActionGate["reason"],
  requirements: ProjectStatusActionGate["requirements"],
): string {
  if (reason === "project-is-local-only") return "Enable sync before opening this project on the web";
  if (reason === "cloud-sync-not-ready") {
    const labels = projectShareRequirementLabels(requirements);
    const missing = labels.length > 0
      ? `: ${labels.join(", ")}`
      : "";
    return `Finish cloud sync setup before opening in web${missing}`;
  }
  if (reason === "sync-mode-unknown") return "Resolve project sync mode before opening in web";
  return "Open project in web";
}

function projectShareRequirementLabel(requirement: string): string {
  if (requirement === "asset-metadata") return "asset metadata";
  if (requirement === "revision-content") return "revision content";
  if (requirement === "enable-sync") return "enable sync";
  if (requirement === "sync-mode") return "sync mode";
  return requirement;
}

function projectShareRequirementLabels(requirements: readonly string[]): string[] {
  return requirements
    .filter((requirement) => requirement !== "room")
    .map(projectShareRequirementLabel);
}
