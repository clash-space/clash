/**
 * Settings route — UI from OSS apps/web's SettingsClient (verbatim port).
 * Data fetching adapted to TanStack Query; auth gate handled by _app.tsx.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import SettingsClient from "@clash/web-ui/components/SettingsClient";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function useArrayQuery(key: string, url: string) {
  return useQuery({
    queryKey: ["settings", key],
    queryFn: async () => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return [];
      return r.json() as Promise<unknown[]>;
    },
    enabled: typeof window !== "undefined",
  });
}

function SettingsPage() {
  const tokensQ = useArrayQuery("tokens", "/api/settings/tokens");
  const variablesQ = useArrayQuery("variables", "/api/settings/variables");
  const actionsQ = useArrayQuery("actions", "/api/settings/actions");
  const skillsQ = useArrayQuery("skills", "/api/settings/skills");

  return (
    <SettingsClient
      initialTokens={(tokensQ.data ?? []) as any}
      initialVariables={(variablesQ.data ?? []) as any}
      initialActions={(actionsQ.data ?? []) as any}
      initialSkills={(skillsQ.data ?? []) as any}
    />
  );
}
