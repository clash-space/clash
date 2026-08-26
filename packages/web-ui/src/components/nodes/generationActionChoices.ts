import {
  capabilityFromCustom,
  customActionDefaultParams,
  validateRefs,
  type CustomActionDefinition,
  type ModelCard,
  type Modality,
  type AigcActionKind,
} from "@clash/shared-types";

export type GenerationActionChoice =
  | {
      kind: "model";
      value: `model:${string}`;
      id: string;
      label: string;
      description?: string;
      model: ModelCard;
    }
  | {
      kind: "action";
      value: `action:${string}`;
      id: string;
      label: string;
      description?: string;
      action: CustomActionDefinition;
    };

export function generationChoiceDefaults(
  action: Pick<CustomActionDefinition, "parameters">,
): Record<string, string | number | boolean> {
  return customActionDefaultParams(action);
}

export function listGenerationActionChoices(options: {
  outputKind: AigcActionKind;
  models: readonly ModelCard[];
  customActions: readonly CustomActionDefinition[];
  referenceCounts?: Partial<Record<Modality, number>>;
}): GenerationActionChoice[] {
  const modelChoices: GenerationActionChoice[] = options.models.map((model) => ({
    kind: "model",
    value: `model:${model.id}`,
    id: model.id,
    label: model.name,
    description: model.description,
    model,
  }));
  const actionChoices: GenerationActionChoice[] = options.customActions
    .filter((action) => action.outputType === options.outputKind)
    .filter((action) => action.presentation.type === "form")
    .filter((action) => !options.referenceCounts
      || validateRefs(capabilityFromCustom(action), options.referenceCounts, {
        enforceMinimums: false,
      }) === null)
    .map((action) => ({
      kind: "action",
      value: `action:${action.id}`,
      id: action.id,
      label: action.name,
      description: action.description,
      action,
    }));
  return [...modelChoices, ...actionChoices];
}
