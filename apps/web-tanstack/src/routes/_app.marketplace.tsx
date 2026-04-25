import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import MarketplaceClient from "@clash/web-ui/components/MarketplaceClient";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";

interface RegistryData {
  version: number;
  actions: RegistryItem[];
  skills: RegistryItem[];
}

export const Route = createFileRoute("/_app/marketplace")({
  component: MarketplacePage,
});

function MarketplacePage() {
  const dataQ = useQuery({
    queryKey: ["marketplace"],
    queryFn: async () => {
      const [registryRes, actions, skills] = await Promise.all([
        fetch("/api/marketplace/registry").then((r) =>
          r.ok
            ? (r.json() as Promise<RegistryData>)
            : ({ version: 1, actions: [], skills: [] } as RegistryData),
        ),
        fetch("/api/settings/actions", { credentials: "include" }).then((r) =>
          r.ok ? (r.json() as Promise<any[]>) : [],
        ),
        fetch("/api/settings/skills", { credentials: "include" }).then((r) =>
          r.ok ? (r.json() as Promise<any[]>) : [],
        ),
      ]);

      const items = [...registryRes.actions, ...registryRes.skills];
      return {
        items,
        installedActionIds: actions.map((a: any) => a.actionId),
        installedSkillIds: skills.map((s: any) => s.skillId),
      };
    },
    enabled: typeof window !== "undefined",
  });

  return (
    <MarketplaceClient
      items={dataQ.data?.items ?? []}
      installedActionIds={dataQ.data?.installedActionIds ?? []}
      installedSkillIds={dataQ.data?.installedSkillIds ?? []}
    />
  );
}
