import { useDraggable } from "@dnd-kit/core";

import type { RegistryItem } from "@clash/web-ui/lib/clientActions";

import type { DashboardSkillDragData } from "./dashboardComposerDnd";
import type { SkillReference } from "./dashboardComposerReferences";

export type AddMarketplaceSkillReference = (
  reference: SkillReference,
) => void | Promise<void>;

export function marketplaceSkillReference(
  item: Pick<RegistryItem, "id" | "name" | "type">,
): SkillReference | null {
  if (item.type !== "skill") return null;
  return { id: item.id, name: item.name };
}

export function useMarketplaceSkillReferenceDraggable(input: {
  item: RegistryItem;
  enabled: boolean;
  requestAdd: () => void | Promise<void>;
}) {
  const reference = marketplaceSkillReference(input.item);
  const data: DashboardSkillDragData | undefined = reference
    ? {
        type: "dashboard-skill-reference",
        reference,
        requestAdd: input.requestAdd,
      }
    : undefined;

  return useDraggable({
    id: `marketplace-skill-reference:${input.item.id}`,
    disabled: !input.enabled || !reference,
    attributes: {
      role: "group",
      roleDescription: "Draggable Marketplace skill",
      tabIndex: 0,
    },
    data,
  });
}
