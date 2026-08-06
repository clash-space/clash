import { Hono } from "hono";
import type { Env } from "../config";
import firstPartyRegistry from "../../../../skills/registry.json";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json";

interface RegistryData {
  version: number;
  marketplaceSemantics?: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown> & { id?: unknown }>;
  systemCapabilities?: Array<Record<string, unknown>>;
  thirdPartyReferences?: Array<Record<string, unknown>>;
}

const FIRST_PARTY = firstPartyRegistry as RegistryData;

const CODEX_IMAGEGEN_MARKETPLACE_ITEM = {
  id: "codex-imagegen",
  name: "Codex ImageGen",
  type: "action",
  description:
    "Generate or edit images with Codex's built-in image generation tool and your ChatGPT subscription.",
  runtime: "local",
  outputType: "image",
  packageId: "clash-codex-imagegen",
  version: "0.1.0",
  author: "Clash",
  icon: "✨",
  color: "#57534e",
  tags: ["image", "codex", "local", "chatgpt"],
  promptModalities: ["text", "image"],
} as const;

function firstPartyActions(): Array<Record<string, unknown>> {
  return [CODEX_IMAGEGEN_MARKETPLACE_ITEM, ...FIRST_PARTY.actions];
}

function isRegistryData(value: unknown): value is RegistryData {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<RegistryData>;
  return Array.isArray(maybe.actions) && Array.isArray(maybe.skills);
}

function mergeRegistry(remote: RegistryData | null): RegistryData {
  if (!remote) return { ...FIRST_PARTY, actions: firstPartyActions() };

  const seenSkillIds = new Set<string>();
  const skills = [...FIRST_PARTY.skills];
  for (const skill of skills) {
    if (typeof skill.id === "string") seenSkillIds.add(skill.id);
  }
  for (const skill of remote.skills) {
    const id = typeof skill.id === "string" ? skill.id : null;
    if (id && seenSkillIds.has(id)) continue;
    if (id) seenSkillIds.add(id);
    skills.push(skill);
  }

  return {
    version: 1,
    marketplaceSemantics: FIRST_PARTY.marketplaceSemantics,
    actions: [...firstPartyActions(), ...remote.actions],
    skills,
    systemCapabilities: FIRST_PARTY.systemCapabilities,
    thirdPartyReferences: FIRST_PARTY.thirdPartyReferences,
  };
}

export const marketplaceRoutes = new Hono<{ Bindings: Env }>();

marketplaceRoutes.get("/registry", async (c) => {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) return c.json(mergeRegistry(null));
    const remote = await res.json();
    return c.json(mergeRegistry(isRegistryData(remote) ? remote : null));
  } catch {
    return c.json(mergeRegistry(null));
  }
});
