// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input } from "./input";
import { SearchableSelect } from "./searchable-select";
import { SelectMenu } from "./select";
import { Textarea } from "./textarea";
import { Button } from "./button";
import { Badge } from "./badge";
import { ControlContextProvider } from "./control-context";

afterEach(() => {
  cleanup();
});

describe("shared control contract", () => {
  it("exposes button and badge variants as component state", () => {
    render(
      <>
        <Button variant="primary" size="sm">
          Run
        </Button>
        <Badge variant="secondary">Draft</Badge>
      </>,
    );

    const button = screen.getByRole("button", { name: "Run" });
    expect(button.dataset.slot).toBe("button");
    expect(button.dataset.variant).toBe("primary");
    expect(button.dataset.size).toBe("sm");

    const badge = screen.getByText("Draft");
    expect(badge.dataset.slot).toBe("badge");
    expect(badge.dataset.variant).toBe("secondary");
  });

  it("lets composed button rows opt out of fixed control density", () => {
    render(<Button size={null}>Provider row</Button>);

    expect(
      screen.getByRole("button", { name: "Provider row" }),
    ).not.toHaveAttribute("data-size");
  });

  it("gives each field family a stable slot and density contract", () => {
    render(
      <>
        <Input aria-label="Project name" />
        <Textarea aria-label="Project brief" />
        <SelectMenu
          ariaLabel="Project type"
          context="timeline"
          value="video"
          options={[{ value: "video", label: "Video" }]}
          onValueChange={() => undefined}
        />
        <SearchableSelect
          ariaLabel="Generation model"
          context="director"
          emptyMessage="No models"
          value="model-a"
          options={[{ value: "model-a", label: "Model A" }]}
          onValueChange={() => undefined}
        />
      </>,
    );

    expect(
      screen
        .getByRole("textbox", { name: "Project name" })
        .getAttribute("data-slot"),
    ).toBe("input");
    expect(
      screen
        .getByRole("textbox", { name: "Project brief" })
        .getAttribute("data-slot"),
    ).toBe("textarea");
    expect(
      screen
        .getByRole("combobox", { name: "Project type" })
        .getAttribute("data-slot"),
    ).toBe("select-trigger");
    expect(
      screen
        .getByRole("combobox", { name: "Generation model" })
        .getAttribute("data-slot"),
    ).toBe("searchable-select-trigger");

    expect(
      screen
        .getByRole("textbox", { name: "Project name" })
        .getAttribute("data-size"),
    ).toBe("default");
    expect(
      screen
        .getByRole("textbox", { name: "Project brief" })
        .getAttribute("data-size"),
    ).toBe("default");
    expect(
      screen
        .getByRole("combobox", { name: "Project type" })
        .getAttribute("data-size"),
    ).toBe("md");
    expect(
      screen
        .getByRole("combobox", { name: "Generation model" })
        .getAttribute("data-size"),
    ).toBe("md");
    expect(
      screen
        .getByRole("combobox", { name: "Project type" })
        .getAttribute("data-context"),
    ).toBe("timeline");
    expect(
      screen
        .getByRole("combobox", { name: "Generation model" })
        .getAttribute("data-context"),
    ).toBe("director");
  });

  it("lets shared textareas inherit their surface context", () => {
    render(
      <ControlContextProvider value="settings">
        <Textarea aria-label="Model description" />
      </ControlContextProvider>,
    );

    const textarea = screen.getByRole("textbox", { name: "Model description" });
    expect(textarea.getAttribute("data-context")).toBe("settings");
    expect(textarea.className).toContain("app-control");
  });

  it.each([
    ["Coral", "coral"],
    ["Information", "blue"],
    ["Installed", "sage"],
    ["Action", "lilac"],
    ["Audio", "amber"],
    ["Media", "teal"],
  ] as const)("maps the %s badge through its semantic tone", (label, tone) => {
    render(<Badge tone={tone}>{label}</Badge>);

    const badge = screen.getByText(label);
    expect(badge.dataset.tone).toBe(tone);
    expect(badge.className).toContain("border-transparent");
    expect(badge.className).not.toContain(`border-tone-${tone}-border`);
    expect(badge.className).toContain(`bg-tone-${tone}-soft`);
    expect(badge.className).toContain(`text-tone-${tone}-ink`);
  });
});
