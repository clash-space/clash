// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SettingsCollection,
  SettingsEmptyState,
  SettingsRow,
  SettingsSectionLayout,
} from "./SettingsPrimitives";

describe("Settings collection primitives", () => {
  afterEach(cleanup);

  it("keeps compact collections wireless while each row owns a restrained surface", () => {
    render(
      <SettingsSectionLayout>
        <SettingsCollection as="ul" aria-label="Available providers">
          <SettingsRow as="li">Provider</SettingsRow>
        </SettingsCollection>
      </SettingsSectionLayout>,
    );

    const section = screen
      .getByText("Provider")
      .closest('[data-slot="settings-section"]');
    expect(section?.getAttribute("data-density")).toBe("compact");

    const collection = screen.getByRole("list", {
      name: "Available providers",
    });
    expect(collection.getAttribute("data-slot")).toBe("settings-collection");
    expect(collection.className).toContain("gap-[var(--settings-row-gap)]");
    expect(collection.className).not.toContain("border-border");

    const row = screen.getByText("Provider");
    expect(row.getAttribute("data-slot")).toBe("settings-row");
    expect(row.className).toContain("rounded-[var(--settings-row-radius)]");
    expect(row.className).toContain("overflow-hidden");
    expect(row.className).toContain("border-border");
    expect(row.className).not.toContain("shadow-xs");
  });

  it("renders inline empty copy without creating another card surface", () => {
    render(
      <SettingsEmptyState>
        No compatible provider account is configured.
      </SettingsEmptyState>,
    );

    const empty = screen.getByText(
      "No compatible provider account is configured.",
    );
    expect(empty.getAttribute("data-slot")).toBe("settings-empty-state");
    expect(empty.className).not.toContain("border");
    expect(empty.className).not.toContain("bg-card");
    expect(empty.className).not.toContain("shadow");
  });
});
