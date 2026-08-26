import { describe, expect, it } from "vitest";

import {
  canAddProjectReference,
  canDragProjectReference,
  dashboardComposerReferencesReducer,
  type DashboardComposerReferencesState,
} from "./dashboardComposerReferences";

const emptyState: DashboardComposerReferencesState = {
  project: null,
  skills: [],
};

describe("dashboard composer references", () => {
  it("keeps at most one project and treats duplicate adds as idempotent", () => {
    const withProject = dashboardComposerReferencesReducer(emptyState, {
      type: "add-project",
      project: { id: "project-1", name: "Storyboard" },
    });
    const duplicate = dashboardComposerReferencesReducer(withProject, {
      type: "add-project",
      project: { id: "project-1", name: "Storyboard renamed elsewhere" },
    });
    const competing = dashboardComposerReferencesReducer(withProject, {
      type: "add-project",
      project: { id: "project-2", name: "Campaign" },
    });

    expect(withProject).toEqual({
      project: { id: "project-1", name: "Storyboard" },
      skills: [],
    });
    expect(duplicate).toBe(withProject);
    expect(competing).toBe(withProject);
  });

  it("unlocks other projects after the current project is removed", () => {
    const withProject = dashboardComposerReferencesReducer(emptyState, {
      type: "add-project",
      project: { id: "project-1", name: "Storyboard" },
    });

    expect(canAddProjectReference(withProject, "project-2")).toBe(false);
    expect(canDragProjectReference(withProject, "project-1")).toBe(true);
    expect(canDragProjectReference(withProject, "project-2")).toBe(false);

    const unlocked = dashboardComposerReferencesReducer(withProject, {
      type: "remove-project",
    });

    expect(unlocked).toEqual({ project: null, skills: [] });
    expect(canAddProjectReference(unlocked, "project-2")).toBe(true);
    expect(canDragProjectReference(unlocked, "project-2")).toBe(true);
  });

  it("lets an explicit selector choice replace the current project without enabling competing drags", () => {
    const withProject = dashboardComposerReferencesReducer(emptyState, {
      type: "add-project",
      project: { id: "project-1", name: "Storyboard" },
    });

    const switched = dashboardComposerReferencesReducer(withProject, {
      type: "select-project",
      project: { id: "project-2", name: "Campaign" },
    });

    expect(switched).toEqual({
      project: { id: "project-2", name: "Campaign" },
      skills: [],
    });
    expect(canDragProjectReference(switched, "project-1")).toBe(false);
  });

  it("keeps multiple skills while deduplicating each skill by id", () => {
    const withFirstSkill = dashboardComposerReferencesReducer(emptyState, {
      type: "add-skill",
      skill: { id: "skill-1", name: "Storyboard planner" },
    });
    const withTwoSkills = dashboardComposerReferencesReducer(withFirstSkill, {
      type: "add-skill",
      skill: { id: "skill-2", name: "Continuity checker" },
    });
    const duplicate = dashboardComposerReferencesReducer(withTwoSkills, {
      type: "add-skill",
      skill: { id: "skill-1", name: "Renamed planner" },
    });

    expect(withTwoSkills).toEqual({
      project: null,
      skills: [
        { id: "skill-1", name: "Storyboard planner" },
        { id: "skill-2", name: "Continuity checker" },
      ],
    });
    expect(duplicate).toBe(withTwoSkills);
    expect(
      dashboardComposerReferencesReducer(withTwoSkills, {
        type: "remove-skill",
        skillId: "skill-1",
      }),
    ).toEqual({
      project: null,
      skills: [{ id: "skill-2", name: "Continuity checker" }],
    });
  });
});
