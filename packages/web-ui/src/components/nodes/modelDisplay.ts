import { ACTION_PROVIDER_PRESETS, type CustomActionDefinition, type ModelCard } from "@clash/shared-types";

export function getModelProviderDisplay({
  isCustom,
  customDef,
}: {
  isCustom: boolean;
  selectedModel?: ModelCard;
  customDef?: CustomActionDefinition;
}): string {
  if (!isCustom) return "";

  const provider = customDef?.model?.provider;
  if (!provider) return "Custom";
  return ACTION_PROVIDER_PRESETS[provider]?.label ?? provider;
}

export function getModelDropdownSecondaryText(compatible: boolean): string | null {
  return compatible ? null : "clears current refs";
}
