import type { RegistryItem } from "@clash/web-ui/lib/clientActions";

export function marketplacePluginPath(
  item: Pick<RegistryItem, "id" | "type">,
): string {
  return `/marketplace/${item.type}/${encodeURIComponent(item.id)}`;
}
