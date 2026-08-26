import { BookOpen, Folder } from "@phosphor-icons/react";

import type { DashboardComposerDragData } from "./dashboardComposerDnd";
import { Badge } from "./ui/badge";

function asDashboardComposerDragData(
  value: unknown,
): DashboardComposerDragData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<DashboardComposerDragData>;
  if (
    data.type !== "dashboard-project-reference" &&
    data.type !== "dashboard-skill-reference"
  ) {
    return null;
  }
  if (
    typeof data.reference?.id !== "string" ||
    typeof data.reference.name !== "string"
  ) {
    return null;
  }
  if (
    data.type === "dashboard-skill-reference" &&
    typeof data.requestAdd !== "function"
  ) {
    return null;
  }
  return data as DashboardComposerDragData;
}

export function DashboardComposerDragOverlay({ data }: { data: unknown }) {
  const drag = asDashboardComposerDragData(data);
  if (!drag) return null;

  const Icon =
    drag.type === "dashboard-project-reference" ? Folder : BookOpen;
  return (
    <Badge
      role="status"
      aria-label={`Dragging ${drag.reference.name} to composer`}
      variant="secondary"
      className="gap-1.5 rounded-lg bg-warm-surface px-2.5 py-1.5 text-xs font-medium text-content-primary shadow-md"
    >
      <Icon className="h-3.5 w-3.5" weight="bold" aria-hidden="true" />
      <span className="max-w-56 truncate">{drag.reference.name}</span>
    </Badge>
  );
}
