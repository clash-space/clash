import { describe, expect, it, vi } from "vitest";

import { handleMentionComboboxKeyDown } from "./mentionComboboxKeyboard";

function keyboardEvent(key: string) {
  return {
    key,
    preventDefault: vi.fn(),
  };
}

function comboboxStore(activeId?: string) {
  return {
    getState: vi.fn(() => ({ activeId })),
    next: vi.fn(() => "mention-b"),
    previous: vi.fn(() => "mention-a"),
    setActiveId: vi.fn(),
  };
}

const items = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];

describe("handleMentionComboboxKeyDown", () => {
  it("moves active Ariakit combobox item with arrow keys", () => {
    const store = comboboxStore("mention-a");
    const event = keyboardEvent("ArrowDown");

    const handled = handleMentionComboboxKeyDown(event, {
      store,
      items,
      getItemId: (item) => `mention-${item.id}`,
      onSelect: vi.fn(),
      onClose: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(store.next).toHaveBeenCalledTimes(1);
    expect(store.setActiveId).toHaveBeenCalledWith("mention-b");
  });

  it("selects the active item and falls back to the first item", () => {
    const store = comboboxStore(undefined);
    const onSelect = vi.fn();
    const event = keyboardEvent("Enter");

    const handled = handleMentionComboboxKeyDown(event, {
      store,
      items,
      getItemId: (item) => `mention-${item.id}`,
      onSelect,
      onClose: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("closes the menu on escape and ignores unrelated keys", () => {
    const store = comboboxStore("mention-a");
    const onClose = vi.fn();

    expect(handleMentionComboboxKeyDown(keyboardEvent("x"), {
      store,
      items,
      getItemId: (item) => `mention-${item.id}`,
      onSelect: vi.fn(),
      onClose,
    })).toBe(false);

    const event = keyboardEvent("Escape");
    expect(handleMentionComboboxKeyDown(event, {
      store,
      items,
      getItemId: (item) => `mention-${item.id}`,
      onSelect: vi.fn(),
      onClose,
    })).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
