type ToolbarRoot = {
  contains: (target: Node) => boolean;
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
  const targetNode = target as Node;
  return !toolbarRoot.contains(targetNode) && !flyoutRoot?.contains(targetNode);
}

export function shouldDismissToolbarMenuOnKey(activeMenu: string | null, key: string) {
  return Boolean(activeMenu && key === "Escape");
}
