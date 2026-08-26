// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchField, SearchFilterToolbar } from "./SearchFilterToolbar";

function FilterSearchHarness({
  initialType = [],
  initialProvider = [],
}: {
  initialType?: string[];
  initialProvider?: string[];
}) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState(initialType);
  const [providers, setProviders] = useState(initialProvider);

  return (
    <SearchFilterToolbar
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search catalog"
      filterGroups={[
        {
          id: "type",
          label: "Type",
          options: [
            { value: "action", label: "Actions" },
            { value: "skill", label: "Skills" },
          ],
          selectedValues: types,
          onSelectedValuesChange: setTypes,
        },
        {
          id: "provider",
          label: "Provider",
          options: [
            { value: "openai", label: "OpenAI" },
            { value: "fal", label: "fal.ai" },
          ],
          selectedValues: providers,
          onSelectedValuesChange: setProviders,
        },
      ]}
    />
  );
}

describe("SearchFilterToolbar", () => {
  afterEach(cleanup);

  it("keeps search and filters inside one unified query control", () => {
    const { container } = render(
      <SearchFilterToolbar
        query=""
        onQueryChange={vi.fn()}
        searchLabel="Search catalog"
        filterGroups={[
          {
            id: "type",
            label: "Type",
            options: [{ value: "action", label: "Actions" }],
            selectedValues: [],
            onSelectedValuesChange: vi.fn(),
          },
        ]}
      />,
    );

    const toolbar = container.querySelector<HTMLElement>(
      '[data-slot="search-filter-toolbar"]',
    );
    const searchField = container.querySelector<HTMLElement>(
      '[data-slot="search-field"]',
    );

    expect(toolbar).toContainElement(searchField);
    expect(searchField).toContainElement(
      screen.getByRole("button", { name: "Filter" }),
    );
    expect(
      container.querySelector('[data-slot="search-filter-controls"]'),
    ).toBeNull();
    expect(searchField).toHaveAttribute("data-leading-icon", "true");
    expect(searchField).toContainElement(
      screen.getByRole("searchbox", { name: "Search catalog" }),
    );
    expect(toolbar).not.toHaveClass("border-b", "border-border");
  });

  it("offers the same leading-icon search field without requiring filters", () => {
    const { container } = render(
      <SearchField
        query=""
        onQueryChange={vi.fn()}
        searchLabel="Search providers"
      />,
    );

    expect(container.querySelector('[data-slot="search-field"]')).toHaveAttribute(
      "data-leading-icon",
      "true",
    );
    expect(screen.getByRole("searchbox", { name: "Search providers" })).toHaveClass(
      "border-0",
    );
  });

  it("keeps full-text search editable while every selected option gets its own chip", () => {
    const { container } = render(<FilterSearchHarness />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Type" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Skills" }));

    const chips = container.querySelectorAll('[data-slot="search-filter-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("Type · Actions");
    expect(chips[1]).toHaveTextContent("Type · Skills");

    const search = screen.getByRole("searchbox", { name: "Search catalog" });
    fireEvent.change(search, { target: { value: "video" } });
    expect(search).toHaveValue("video");
  });

  it("removes one option from its chip and removes the last option with Backspace", () => {
    const { container } = render(
      <FilterSearchHarness
        initialType={["action", "skill"]}
        initialProvider={["openai"]}
      />,
    );

    expect(
      container.querySelectorAll('[data-slot="search-filter-chip"]'),
    ).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Type filter: Actions" }),
    );
    expect(screen.queryByText("Type · Actions")).toBeNull();
    expect(screen.getByText("Type · Skills")).toBeTruthy();
    expect(screen.getByText("Provider · OpenAI")).toBeTruthy();

    fireEvent.keyDown(
      screen.getByRole("searchbox", { name: "Search catalog" }),
      { key: "Backspace" },
    );
    expect(
      container.querySelectorAll('[data-slot="search-filter-chip"]'),
    ).toHaveLength(1);
    expect(screen.getByText("Type · Skills")).toBeTruthy();
  });

  it("keeps a visible gap between sibling options in a filter submenu", () => {
    render(
      <FilterSearchHarness initialType={["action", "skill"]} />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Type/ }));

    expect(
      document.querySelector('[data-slot="dropdown-menu-sub-content"]'),
    ).toHaveClass("gap-[var(--select-item-gap)]");
  });
});
