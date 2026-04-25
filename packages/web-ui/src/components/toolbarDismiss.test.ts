import { describe, expect, it } from "vitest";
import { shouldDismissToolbarMenu, shouldDismissToolbarMenuOnKey } from "./toolbarDismiss";

describe("toolbar menu dismissal", () => {
  const insideTarget = {};
  const outsideTarget = {};
  const toolbarRoot = {
    contains: (target: EventTarget) => target === insideTarget,
  };
  const flyoutTarget = {};
  const flyoutRoot = {
    contains: (target: EventTarget) => target === flyoutTarget,
  };

  it("keeps the menu open for interactions inside the toolbar", () => {
    expect(
      shouldDismissToolbarMenu({
        activeMenu: "create",
        toolbarRoot,
        target: insideTarget as EventTarget,
      }),
    ).toBe(false);
  });

  it("dismisses an open menu when focus or pointer moves outside", () => {
    expect(
      shouldDismissToolbarMenu({
        activeMenu: "create",
        toolbarRoot,
        target: outsideTarget as EventTarget,
      }),
    ).toBe(true);
  });

  it("keeps the menu open for interactions inside the detached flyout", () => {
    expect(
      shouldDismissToolbarMenu({
        activeMenu: "create",
        toolbarRoot,
        flyoutRoot,
        target: flyoutTarget as EventTarget,
      }),
    ).toBe(false);
  });

  it("does not dismiss when no menu is open", () => {
    expect(
      shouldDismissToolbarMenu({
        activeMenu: null,
        toolbarRoot,
        target: outsideTarget as EventTarget,
      }),
    ).toBe(false);
  });

  it("dismisses an open menu on Escape only", () => {
    expect(shouldDismissToolbarMenuOnKey("create", "Escape")).toBe(true);
    expect(shouldDismissToolbarMenuOnKey("create", "Enter")).toBe(false);
    expect(shouldDismissToolbarMenuOnKey(null, "Escape")).toBe(false);
  });
});
