export interface MentionComboboxKeyboardEvent {
  key: string;
  preventDefault: () => void;
}

export interface MentionComboboxKeyboardStore {
  getState: () => { activeId?: string | null };
  next: () => string | null | undefined;
  previous: () => string | null | undefined;
  setActiveId: (activeId?: string | null) => void;
}

export interface MentionComboboxKeyboardOptions<T> {
  store: MentionComboboxKeyboardStore;
  items: readonly T[];
  getItemId: (item: T) => string;
  onSelect: (item: T) => void;
  onClose: () => void;
}

export function handleMentionComboboxKeyDown<T>(
  event: MentionComboboxKeyboardEvent,
  { store, items, getItemId, onSelect, onClose }: MentionComboboxKeyboardOptions<T>,
): boolean {
  if (items.length === 0) return false;

  const firstItemId = getItemId(items[0]);
  const lastItemId = getItemId(items[items.length - 1]);

  if (event.key === "ArrowDown") {
    event.preventDefault();
    store.setActiveId(store.next() ?? firstItemId);
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    store.setActiveId(store.previous() ?? lastItemId);
    return true;
  }

  if (event.key === "Enter" || event.key === "Tab") {
    const activeId = store.getState().activeId;
    const selected = items.find((item) => getItemId(item) === activeId) ?? items[0];

    event.preventDefault();
    onSelect(selected);
    return true;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return true;
  }

  return false;
}
