import { describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_COMPOSER_DROP_ID,
  handleDashboardComposerDragEnd,
} from "./dashboardComposerDnd";

describe("dashboard composer drag boundary", () => {
  it("adds a Project reference only when it lands on the Composer", async () => {
    const addProject = vi.fn();
    const drag = {
      active: {
        data: {
          current: {
            type: "dashboard-project-reference" as const,
            reference: { id: "project-a", name: "Project A" },
          },
        },
      },
      over: { id: DASHBOARD_COMPOSER_DROP_ID },
    };

    await handleDashboardComposerDragEnd(drag, { addProject });
    expect(addProject).toHaveBeenCalledWith({
      id: "project-a",
      name: "Project A",
    });

    addProject.mockClear();
    await handleDashboardComposerDragEnd(
      { ...drag, over: { id: "somewhere-else" } },
      { addProject },
    );
    expect(addProject).not.toHaveBeenCalled();
  });

  it("runs the Skill install-and-add contract only after a Composer drop", async () => {
    const requestAdd = vi.fn().mockResolvedValue(undefined);

    await handleDashboardComposerDragEnd(
      {
        active: {
          data: {
            current: {
              type: "dashboard-skill-reference" as const,
              reference: { id: "skill-a", name: "sd25-pe" },
              requestAdd,
            },
          },
        },
        over: { id: DASHBOARD_COMPOSER_DROP_ID },
      },
      { addProject: vi.fn() },
    );

    expect(requestAdd).toHaveBeenCalledOnce();
  });

  it("ignores unknown drag payloads", async () => {
    const addProject = vi.fn();

    await handleDashboardComposerDragEnd(
      {
        active: { data: { current: { type: "timeline-item" } } },
        over: { id: DASHBOARD_COMPOSER_DROP_ID },
      },
      { addProject },
    );

    expect(addProject).not.toHaveBeenCalled();
  });
});
