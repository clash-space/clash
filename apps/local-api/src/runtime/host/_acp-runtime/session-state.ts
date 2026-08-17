import type {
  SessionConfigOption,
  SessionModeState,
} from "@agentclientprotocol/sdk";

const LEGACY_MODEL_META_KEY = "openma.dev/legacy-model-state";

interface LegacyModelState {
  currentModelId: string;
  availableModels: Array<{
    modelId: string;
    name: string;
    description?: string;
  }>;
}

interface SessionStateResponse {
  configOptions?: SessionConfigOption[] | null;
  modes?: SessionModeState | null;
  models?: unknown;
}

function legacyModelStateFromResponse(value: unknown): LegacyModelState | null {
  if (!value || typeof value !== "object") return null;
  const models = (value as { models?: unknown }).models;
  if (!models || typeof models !== "object") return null;
  const { currentModelId, availableModels } = models as {
    currentModelId?: unknown;
    availableModels?: unknown;
  };
  if (typeof currentModelId !== "string" || !Array.isArray(availableModels)) {
    return null;
  }
  const normalized = availableModels.flatMap((model) => {
    if (!model || typeof model !== "object") return [];
    const candidate = model as {
      modelId?: unknown;
      name?: unknown;
      description?: unknown;
    };
    if (typeof candidate.modelId !== "string" || typeof candidate.name !== "string") {
      return [];
    }
    return [{
      modelId: candidate.modelId,
      name: candidate.name,
      ...(typeof candidate.description === "string"
        ? { description: candidate.description }
        : {}),
    }];
  });
  return normalized.length > 0
    ? { currentModelId, availableModels: normalized }
    : null;
}

function isModelConfigOption(option: SessionConfigOption): boolean {
  return option.category === "model" || option.id === "model";
}

function legacyModelConfigOption(state: LegacyModelState): SessionConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: state.currentModelId,
    options: state.availableModels.map((model) => ({
      value: model.modelId,
      name: model.name,
      ...(model.description ? { description: model.description } : {}),
    })),
    _meta: { [LEGACY_MODEL_META_KEY]: true },
  };
}

export function isLegacyModelConfigOption(option: SessionConfigOption): boolean {
  return option._meta?.[LEGACY_MODEL_META_KEY] === true;
}

export function sessionConfigOptionsFromResponse(value: unknown): SessionConfigOption[] {
  const response = value as SessionStateResponse | undefined;
  const configOptions = Array.isArray(response?.configOptions)
    ? response.configOptions.map((option) => structuredClone(option))
    : [];
  const legacyModels = legacyModelStateFromResponse(value);
  if (legacyModels && !configOptions.some(isModelConfigOption)) {
    configOptions.push(legacyModelConfigOption(legacyModels));
  }
  return configOptions;
}

export function responseHasSessionConfig(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const response = value as SessionStateResponse;
  return Array.isArray(response.configOptions) || legacyModelStateFromResponse(value) !== null;
}
