type ToolbarRoot = {
  contains: (target: EventTarget) => boolean;
};

export function shouldDismissToolbarMenu({
  activeMenu,
  toolbarRoot,
  flyoutRoot,
  target,
}: {
  activeMenu: string | null;
  toolbarRoot: ToolbarRoot | null;
  flyoutRoot?: ToolbarRoot | null;
  target: EventTarget | null;
}) {
  if (!activeMenu || !toolbarRoot || !target) return false;
  return !toolbarRoot.contains(target) && !flyoutRoot?.contains(target);
}

export function shouldDismissToolbarMenuOnKey(activeMenu: string | null, key: string) {
  return Boolean(activeMenu && key === "Escape");
}
