// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectCreateTile from "./ProjectCreateTile";

vi.mock("@phosphor-icons/react", () => ({
  Plus: ({ className, ...props }: any) => (
    <span data-testid="plus-icon" className={className} {...props} />
  ),
  X: ({ className, ...props }: any) => (
    <span data-testid="close-icon" className={className} {...props} />
  ),
}));

describe("ProjectCreateTile", () => {
  afterEach(cleanup);

  it("collects a project name before creating", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectCreateTile ariaLabel="Start a new project" onCreate={onCreate} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /start a new project/i }),
    );

    expect(
      screen.getByRole("dialog", { name: /create project/i }),
    ).toBeTruthy();
    const nameInput = screen.getByRole("textbox", { name: /project name/i });
    expect(document.activeElement).toBe(nameInput);

    fireEvent.change(nameInput, { target: { value: "  Summer launch  " } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith("Summer launch");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not submit an empty project name", () => {
    const onCreate = vi.fn();

    render(
      <ProjectCreateTile ariaLabel="Start a new project" onCreate={onCreate} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /start a new project/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: /project name/i }),
    );
  });
});
