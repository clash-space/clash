// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DashboardComposerProvider,
  useDashboardComposer,
} from "./DashboardComposerContext";

function ContextHarness({ focus }: { focus?: () => void }) {
  const composer = useDashboardComposer();

  return (
    <>
      <output aria-label="draft">{composer.input}</output>
      <output aria-label="project">
        {composer.references.project?.name ?? "none"}
      </output>
      <output aria-label="skills">
        {composer.references.skills.map((skill) => skill.name).join(",")}
      </output>
      <button
        type="button"
        onClick={() => composer.setInput("Make a quiet forest scene")}
      >
        Type draft
      </button>
      <button
        type="button"
        onClick={() =>
          composer.addProjectReference({ id: "project-a", name: "Project A" })
        }
      >
        Add project A
      </button>
      <button
        type="button"
        disabled={!composer.canAddProjectReference("project-b")}
        onClick={() =>
          composer.addProjectReference({ id: "project-b", name: "Project B" })
        }
      >
        Add project B
      </button>
      <button type="button" onClick={composer.removeProjectReference}>
        Remove project
      </button>
      <button
        type="button"
        onClick={() =>
          composer.addSkillReference({ id: "skill-a", name: "Skill A" })
        }
      >
        Add skill A
      </button>
      <button
        type="button"
        onClick={() => composer.registerComposerFocus(focus ?? null)}
      >
        Register focus
      </button>
      <button type="button" onClick={composer.focusComposer}>
        Focus composer
      </button>
    </>
  );
}

describe("DashboardComposerProvider", () => {
  afterEach(cleanup);

  it("keeps the draft and references in one shell-owned state", () => {
    render(
      <DashboardComposerProvider>
        <ContextHarness />
      </DashboardComposerProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Type draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Add project A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add skill A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add skill A" }));

    expect(screen.getByLabelText("draft").textContent).toBe(
      "Make a quiet forest scene",
    );
    expect(screen.getByLabelText("project").textContent).toBe("Project A");
    expect(screen.getByLabelText("skills").textContent).toBe("Skill A");
  });

  it("locks other projects until the selected project is removed", () => {
    render(
      <DashboardComposerProvider>
        <ContextHarness />
      </DashboardComposerProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add project A" }));
    expect(screen.getByRole("button", { name: "Add project B" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));
    expect(screen.getByRole("button", { name: "Add project B" })).toBeEnabled();
  });

  it("lets a separate Home affordance focus the registered bottom dock", () => {
    const focus = vi.fn();
    render(
      <DashboardComposerProvider>
        <ContextHarness focus={focus} />
      </DashboardComposerProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Register focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Focus composer" }));

    expect(focus).toHaveBeenCalledOnce();
  });
});
