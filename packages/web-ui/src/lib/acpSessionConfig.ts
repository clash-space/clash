import type {
  AcpSessionConfigOption,
  AcpSessionModeState,
} from "@clash/web-ui/hooks/useClashRuntime";

export type AcpSelectValue = {
  value: string;
  name: string;
  description?: string | null;
  groupName?: string;
};

export function agentDisplayName(agentId?: string | null): string {
  if (!agentId) return "Agent";
  if (agentId === "codex-acp") return "Codex";
  if (agentId === "claude-acp") return "Claude";
  if (agentId === "gemini") return "Gemini";
  if (agentId === "mock-acp") return "Mock ACP";
  return agentId
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function findAcpSelectConfigOption(
  options: AcpSessionConfigOption[],
  category: "model" | "thought_level" | "mode",
): AcpSessionConfigOption | null {
  return (
    options.find(
      (option) =>
        option.type === "select" &&
        option.category === category &&
        Array.isArray(option.options),
    ) ?? null
  );
}

function isAcpSelectConfigOption(option: AcpSessionConfigOption): boolean {
  return option.type === "select" && Array.isArray(option.options);
}

export function flattenAcpSelectValues(
  option?: AcpSessionConfigOption | null,
): AcpSelectValue[] {
  if (!option?.options || !isAcpSelectConfigOption(option)) return [];
  return option.options
    .flatMap((entry) => {
      if ("options" in entry && Array.isArray(entry.options)) {
        return entry.options.map((value) => ({
          ...value,
          groupName: entry.name,
        }));
      }
      return [entry as AcpSelectValue];
    })
    .filter(
      (entry): entry is AcpSelectValue =>
        !!entry &&
        typeof entry.value === "string" &&
        typeof entry.name === "string",
    );
}

export function defaultPermissionModeForSession(
  sessionModes?: AcpSessionModeState | null,
  modeConfigOption?: AcpSessionConfigOption | null,
): string | null {
  const modeValues = flattenAcpSelectValues(modeConfigOption);
  if (
    typeof modeConfigOption?.currentValue === "string" &&
    modeValues.some((value) => value.value === modeConfigOption.currentValue)
  ) {
    return modeConfigOption.currentValue;
  }
  if (modeValues.length > 0) return modeValues[0]?.value ?? null;
  const availableModes = sessionModes?.availableModes ?? [];
  if (
    sessionModes?.currentModeId &&
    availableModes.some((mode) => mode.id === sessionModes.currentModeId)
  ) {
    return sessionModes.currentModeId;
  }
  if (availableModes.length > 0) return availableModes[0]?.id ?? null;
  return null;
}

function isPermissionModeValidForSession(
  modeId: string | undefined,
  sessionModes?: AcpSessionModeState | null,
  modeConfigOption?: AcpSessionConfigOption | null,
): modeId is string {
  if (!modeId) return false;
  const modeValues = flattenAcpSelectValues(modeConfigOption);
  if (modeValues.length > 0)
    return modeValues.some((value) => value.value === modeId);
  const availableModes = sessionModes?.availableModes ?? [];
  if (availableModes.length > 0)
    return availableModes.some((mode) => mode.id === modeId);
  return false;
}

export function resolvePermissionModeForSession(
  savedModeId: string | undefined,
  sessionModes?: AcpSessionModeState | null,
  modeConfigOption?: AcpSessionConfigOption | null,
): string | null {
  if (
    isPermissionModeValidForSession(savedModeId, sessionModes, modeConfigOption)
  )
    return savedModeId;
  return defaultPermissionModeForSession(sessionModes, modeConfigOption);
}

export function permissionModeOption(modeId: string | null | undefined): {
  permissionModeId?: string;
} {
  return modeId ? { permissionModeId: modeId } : {};
}
