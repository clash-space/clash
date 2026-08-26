export interface ProjectReference {
  id: string;
  name: string;
}

export interface SkillReference {
  id: string;
  name: string;
}

export type DashboardProjectReference = ProjectReference;
export type DashboardSkillReference = SkillReference;

export interface DashboardComposerReferencesState {
  project: ProjectReference | null;
  skills: SkillReference[];
}

export const initialDashboardComposerReferences: DashboardComposerReferencesState =
  {
    project: null,
    skills: [],
  };

export type DashboardComposerReferencesAction =
  | { type: "add-project"; project: ProjectReference }
  | { type: "select-project"; project: ProjectReference }
  | { type: "remove-project" }
  | { type: "add-skill"; skill: SkillReference }
  | { type: "remove-skill"; skillId: string };

export function canAddProjectReference(
  state: DashboardComposerReferencesState,
  _projectId: string,
): boolean {
  return state.project === null;
}

export function canDragProjectReference(
  state: DashboardComposerReferencesState,
  projectId: string,
): boolean {
  return state.project === null || state.project.id === projectId;
}

export function dashboardComposerReferencesReducer(
  state: DashboardComposerReferencesState,
  action: DashboardComposerReferencesAction,
): DashboardComposerReferencesState {
  switch (action.type) {
    case "add-project":
      if (state.project) return state;
      return { ...state, project: action.project };
    case "select-project":
      if (
        state.project?.id === action.project.id &&
        state.project.name === action.project.name
      ) {
        return state;
      }
      return { ...state, project: action.project };
    case "remove-project":
      if (!state.project) return state;
      return { ...state, project: null };
    case "add-skill":
      if (state.skills.some((skill) => skill.id === action.skill.id)) {
        return state;
      }
      return { ...state, skills: [...state.skills, action.skill] };
    case "remove-skill": {
      const skills = state.skills.filter(
        (skill) => skill.id !== action.skillId,
      );
      return skills.length === state.skills.length
        ? state
        : { ...state, skills };
    }
  }
}
