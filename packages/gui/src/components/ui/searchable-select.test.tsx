// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "./searchable-select";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function ResizeObserver() {
      return {
        disconnect: vi.fn(),
        observe: vi.fn(),
        unobserve: vi.fn(),
      };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SearchableSelect", () => {
  it("uses cmdk for search state inside the shared Radix popover", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/gui/src/components/ui/searchable-select.tsx",
      ),
      "utf8",
    );

    const commandSource = readFileSync(
      join(process.cwd(), "packages/gui/src/components/ui/command.tsx"),
      "utf8",
    );

    expect(source).toContain("./command");
    expect(commandSource).toContain('from "cmdk"');
    expect(source).toContain("./popover");
    expect(source).toContain("<CommandInput");
    expect(source).toContain("<CommandList");
    expect(source).toContain("<CommandItem");
    expect(commandSource).not.toContain("app-select-content");
    expect(source).not.toContain("@ariakit/react");
    expect(source).not.toContain('role="listbox"');
    expect(source).not.toContain('role="option"');
    expect(source).not.toContain("aria-selected");
    expect(source).not.toContain("onKeyDown={(event) =>");
    expect(source).not.toContain("selectActiveComboboxOption");
  });

  it("lets Radix own disclosure behavior and keeps only the composed open value", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/gui/src/components/ui/searchable-select.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("<Popover open={open} onOpenChange={setOpen}>");
    expect(source).not.toContain("addEventListener");
    expect(source).not.toContain("onKeyDown=");
    expect(source).not.toContain("onClickOutside");
  });

  it("renders a select trigger with an in-popover searchable combobox", () => {
    const onValueChange = vi.fn();

    render(
      <SearchableSelect
        ariaLabel="Model to test"
        emptyMessage="No matching models."
        listboxLabel="Model to test"
        onValueChange={onValueChange}
        options={[
          { value: "text-model", label: "Mock Text Model" },
          { value: "image-model", label: "Mock Image Model" },
        ]}
        searchAriaLabel="Search test models"
        searchPlaceholder="Search models..."
        value="text-model"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Model to test" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.textContent).toContain("Mock Text Model");

    fireEvent.click(trigger);

    expect(
      document.querySelector("[data-radix-popper-content-wrapper]"),
    ).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Suggestions" })).toBeTruthy();

    const search = screen.getByRole("combobox", {
      name: "Search test models",
    }) as HTMLInputElement;
    expect(search.tagName).toBe("INPUT");

    fireEvent.change(search, {
      target: { value: "image" },
    });
    expect(
      screen.queryByRole("option", { name: "Mock Text Model" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Mock Image Model" }));

    expect(onValueChange).toHaveBeenCalledWith(
      "image-model",
      expect.objectContaining({ value: "image-model" }),
    );
  });

  it("projects compact density onto the trigger and portalled cmdk surface", () => {
    render(
      <SearchableSelect
        ariaLabel="Choose project"
        density="compact"
        emptyMessage="No projects."
        onValueChange={vi.fn()}
        options={[
          {
            value: "new",
            label: "New Project",
            description: "Created on send",
          },
        ]}
        value="new"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Choose project" });
    expect(trigger).toHaveAttribute("data-density", "compact");
    fireEvent.click(trigger);

    expect(
      document.querySelector('[data-slot="popover-content"]'),
    ).toHaveAttribute("data-density", "compact");
    const option = screen.getByRole("option", {
      name: "New Project Created on send",
    });
    expect(option).toHaveAttribute("data-density", "compact");
    expect(
      option.querySelector('[data-slot="searchable-select-option-content"]'),
    ).toHaveAttribute("data-layout", "inline");
  });

  it("selects the active filtered option from the keyboard", async () => {
    const onValueChange = vi.fn();

    render(
      <SearchableSelect
        ariaLabel="Model to test"
        emptyMessage="No matching models."
        listboxLabel="Model to test"
        onValueChange={onValueChange}
        options={[
          { value: "text-model", label: "Mock Text Model" },
          { value: "image-model", label: "Mock Image Model" },
        ]}
        searchAriaLabel="Search test models"
        searchPlaceholder="Search models..."
        value="text-model"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Model to test" }));
    const search = screen.getByRole("combobox", { name: "Search test models" });
    fireEvent.change(search, { target: { value: "image" } });
    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "Mock Image Model" }),
      ).toBeTruthy();
    });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyUp(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.keyUp(search, { key: "Enter" });

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalledWith(
        "image-model",
        expect.objectContaining({ value: "image-model" }),
      );
    });
  });

  it("indexes text from rich option labels and descriptions", () => {
    const onValueChange = vi.fn();

    render(
      <SearchableSelect
        ariaLabel="Model to test"
        emptyMessage="No matching models."
        listboxLabel="Model to test"
        onValueChange={onValueChange}
        options={[
          {
            value: "vision-model",
            label: (
              <span>
                <strong>Vision Model</strong>
                <span>image</span>
              </span>
            ),
            description: <span>fal-ai/vision</span>,
          },
          {
            value: "text-model",
            label: "Text Model",
            description: "openai/text",
          },
        ]}
        searchAriaLabel="Search test models"
        searchPlaceholder="Search models..."
        value="text-model"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Model to test" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search test models" }),
      {
        target: { value: "fal-ai/vision" },
      },
    );

    expect(screen.getByRole("option", { name: /Vision Model/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Text Model/ })).toBeNull();
  });
});
