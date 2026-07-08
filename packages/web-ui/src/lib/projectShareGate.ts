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

function projectShareGateTooltip(
  reason: ProjectStatusActionGate["reason"],
  requirements: ProjectStatusActionGate["requirements"],
): string {
  if (reason === "project-is-local-only") return "Enable sync before sharing this project";
  if (reason === "cloud-sync-not-ready") {
    const missing = requirements.length > 0
      ? `: ${requirements.join(", ")}`
      : "";
    return `Finish cloud sync setup before sharing${missing}`;
  }
  if (reason === "sync-mode-unknown") return "Resolve project sync mode before sharing";
  return "Copy project link";
}
