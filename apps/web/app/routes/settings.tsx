import type { ClientLoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import SettingsClient from "@clash/web-ui/components/SettingsClient";

async function fetchJsonOrRedirect(url: string): Promise<unknown[]> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 401) throw redirect("/login");
  if (!res.ok) return [];
  return res.json() as Promise<unknown[]>;
}

export async function clientLoader(_: ClientLoaderFunctionArgs) {
  const [tokens, variables, actions, skills] = await Promise.all([
    fetchJsonOrRedirect("/api/settings/tokens"),
    fetchJsonOrRedirect("/api/settings/variables"),
    fetchJsonOrRedirect("/api/settings/actions"),
    fetchJsonOrRedirect("/api/settings/skills"),
  ]);
  return { tokens, variables, actions, skills };
}

export default function SettingsRoute() {
  const { tokens, variables, actions, skills } =
    useLoaderData<typeof clientLoader>();
  return (
    <SettingsClient
      initialTokens={tokens as any}
      initialVariables={variables as any}
      initialActions={actions as any}
      initialSkills={skills as any}
    />
  );
}
