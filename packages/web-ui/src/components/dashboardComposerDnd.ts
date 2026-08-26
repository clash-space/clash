import type {
  DashboardProjectReference,
  DashboardSkillReference,
} from "./dashboardComposerReferences";

export const DASHBOARD_COMPOSER_DROP_ID = "dashboard-composer-dropzone";

export interface DashboardProjectDragData {
  type: "dashboard-project-reference";
  reference: DashboardProjectReference;
}

export interface DashboardSkillDragData {
  type: "dashboard-skill-reference";
  reference: DashboardSkillReference;
  requestAdd: () => void | Promise<void>;
}

export type DashboardComposerDragData =
  | DashboardProjectDragData
  | DashboardSkillDragData;

interface DashboardComposerDragEndLike {
  active: { data: { current?: unknown } };
  over: { id: string | number } | null;
}

function isProjectDragData(value: unknown): value is DashboardProjectDragData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<DashboardProjectDragData>;
  return (
    data.type === "dashboard-project-reference" &&
    typeof data.reference?.id === "string" &&
    typeof data.reference.name === "string"
  );
}

function isSkillDragData(value: unknown): value is DashboardSkillDragData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<DashboardSkillDragData>;
  return (
    data.type === "dashboard-skill-reference" &&
    typeof data.reference?.id === "string" &&
    typeof data.reference.name === "string" &&
    typeof data.requestAdd === "function"
  );
}

export async function handleDashboardComposerDragEnd(
  event: DashboardComposerDragEndLike,
  actions: { addProject: (project: DashboardProjectReference) => void },
): Promise<void> {
  if (event.over?.id !== DASHBOARD_COMPOSER_DROP_ID) return;
  const data = event.active.data.current;

  if (isProjectDragData(data)) {
    actions.addProject(data.reference);
    return;
  }
  if (isSkillDragData(data)) {
    await data.requestAdd();
  }
}
