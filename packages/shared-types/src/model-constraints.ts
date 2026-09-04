import {
  acceptsCustomModelParameterValue,
  type ModelCard,
  type ModelConstraintRule,
  type ModelParameter,
} from "./models.js";

export interface ParameterConfigurationContract {
  parameters: readonly ModelParameter[];
  defaultParams: Readonly<Record<string, string | number | boolean>>;
  constraints?: readonly ModelConstraintRule[];
}

export type ModelConfigurationInput = {
  prompt?: string;
  lyrics?: string;
  modelParams?: Record<string, string | number | boolean | undefined>;
};

export type ModelConfigurationValidationOptions = {
  rejectUnknownParameters?: boolean;
  allowedParameterIds?: readonly string[];
};

export function coerceModelParameterInput(
  card: ParameterConfigurationContract,
  parameterId: string,
  value: string | number | boolean,
): string | number | boolean {
  const parameter = card.parameters.find((candidate) => candidate.id === parameterId);
  if (!parameter) return value;
  if (parameter.type === "select") {
    const exact = parameter.options?.find((option) => option.value === value);
    if (exact) return exact.value;
    const matchingText = parameter.options?.find((option) => String(option.value) === String(value));
    return matchingText?.value ?? value;
  }
  if (parameter.type === "number" || parameter.type === "slider") {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (parameter.type === "boolean" && typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}

function fieldValue(
  card: ParameterConfigurationContract,
  input: ModelConfigurationInput,
  field: string,
): string | number | boolean | undefined {
  if (field === "prompt") return input.prompt ?? "";
  if (field === "lyrics") return input.lyrics ?? "";
  if (!field.startsWith("modelParams.")) return undefined;
  const parameterId = field.slice("modelParams.".length);
  return input.modelParams?.[parameterId] ?? card.defaultParams[parameterId];
}

function empty(value: string | number | boolean | undefined): boolean {
  return value === undefined || (typeof value === "string" && !value.trim());
}

function fieldLabel(card: ParameterConfigurationContract, field: string): string {
  if (field === "prompt") return "Prompt";
  if (field === "lyrics") return "Lyrics";
  const id = field.slice("modelParams.".length);
  return card.parameters.find((parameter) => parameter.id === id)?.label ?? id;
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right;
}

function validateParameterCandidates(
  card: ParameterConfigurationContract,
  input: ModelConfigurationInput,
  options: ModelConfigurationValidationOptions = {},
): string | null {
  if (options.rejectUnknownParameters && input.modelParams) {
    const declared = new Set([
      ...card.parameters.map((parameter) => parameter.id),
      ...Object.keys(card.defaultParams),
      ...(options.allowedParameterIds ?? []),
    ]);
    const unknown = Object.keys(input.modelParams).find((parameterId) => !declared.has(parameterId));
    if (unknown) return `${unknown} is not declared by this Model Card.`;
  }
  for (const parameter of card.parameters) {
    const fixedValue = card.defaultParams[parameter.id] ?? parameter.defaultValue;
    const suppliedValue = input.modelParams?.[parameter.id];
    if (parameter.readOnly && suppliedValue !== undefined && !sameValue(suppliedValue, fixedValue)) {
      return `${parameter.label} is fixed at ${String(fixedValue)}.`;
    }
    const value = suppliedValue ?? fixedValue;
    if (value === undefined) {
      if (parameter.required) return `${parameter.label} is required.`;
      continue;
    }
    if (parameter.type === "select") {
      if (
        !parameter.options?.some((option) => sameValue(option.value, value))
        && !acceptsCustomModelParameterValue(parameter, value)
      ) {
        if (parameter.allowCustom && parameter.id === "aspect_ratio") {
          return `${parameter.label} must be a valid custom ratio.`;
        }
        return `${parameter.label} must be one of the configured candidates.`;
      }
      continue;
    }
    if (parameter.type === "number" || parameter.type === "slider") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${parameter.label} must be a finite number.`;
      }
      if (parameter.min !== undefined && value < parameter.min) {
        return `${parameter.label} must be at least ${parameter.min}.`;
      }
      if (parameter.max !== undefined && value > parameter.max) {
        return `${parameter.label} must be at most ${parameter.max}.`;
      }
    }
    if (parameter.type === "boolean" && typeof value !== "boolean") {
      return `${parameter.label} must be on or off.`;
    }
  }
  return null;
}

/** Validate the exact Card configuration used by both UI-authored and
 * external/agent-authored requests before any provider projection occurs. */
export function validateModelCardConfiguration(
  card: ModelCard,
  input: ModelConfigurationInput,
  options: ModelConfigurationValidationOptions = {},
): string | null {
  return validateParameterContractConfiguration(card, input, options);
}

/** Validate any Card-shaped parameter contract, including executable Action
 * Cards, using the same candidates, fixed values, and conditional rules. */
export function validateParameterContractConfiguration(
  card: ParameterConfigurationContract,
  input: ModelConfigurationInput,
  options: ModelConfigurationValidationOptions = {},
): string | null {
  const candidateError = validateParameterCandidates(card, input, options);
  if (candidateError) return candidateError;

  for (const rule of card.constraints ?? []) {
    if (rule.type === "required") {
      const applies = rule.when.every((condition) =>
        sameValue(fieldValue(card, input, condition.field), condition.equals));
      if (applies && empty(fieldValue(card, input, rule.field))) {
        return rule.message ?? `${fieldLabel(card, rule.field)} is required.`;
      }
      continue;
    }
    if (rule.type === "max-length") {
      const value = fieldValue(card, input, rule.field);
      if (typeof value === "string" && value.length > rule.max) {
        return rule.message ?? `${fieldLabel(card, rule.field)} accepts at most ${rule.max} characters.`;
      }
      continue;
    }
    const active = rule.fields.filter((field) =>
      sameValue(fieldValue(card, input, field), rule.activeValue));
    if (active.length > 1) {
      return rule.message ?? `${active.map((field) => fieldLabel(card, field)).join(" and ")} cannot be enabled together.`;
    }
  }
  return null;
}

/** Apply a single UI parameter edit while honoring declarative mutual
 * exclusions. The backend still validates the result for non-UI callers. */
export function applyModelParameterChange(
  card: ParameterConfigurationContract | undefined,
  current: Record<string, string | number | boolean>,
  parameterId: string,
  value: string | number | boolean,
): Record<string, string | number | boolean> {
  const parameter = card?.parameters.find((candidate) => candidate.id === parameterId);
  if (parameter?.readOnly) {
    const fixedValue = card?.defaultParams[parameterId] ?? parameter.defaultValue;
    return fixedValue === undefined ? { ...current } : { ...current, [parameterId]: fixedValue };
  }
  const next = { ...current, [parameterId]: value };
  if (!card) return next;
  const changedField = `modelParams.${parameterId}`;
  for (const rule of card.constraints ?? []) {
    if (
      rule.type !== "mutually-exclusive"
      || !sameValue(value, rule.activeValue)
      || !rule.fields.includes(changedField)
    ) continue;
    for (const field of rule.fields) {
      if (field === changedField || !field.startsWith("modelParams.")) continue;
      next[field.slice("modelParams.".length)] = rule.inactiveValue;
    }
  }
  return next;
}

/** Reconcile persisted params with an effective provider Card. Unknown
 * transport-only fields are preserved; invalid user-configurable values fall
 * back to the provider Card's declared default. */
export function normalizeModelParametersForCard(
  card: ParameterConfigurationContract,
  current: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const next = { ...card.defaultParams, ...current };
  for (const parameter of card.parameters) {
    if (parameter.readOnly) {
      const fixedValue = card.defaultParams[parameter.id] ?? parameter.defaultValue;
      if (fixedValue !== undefined) next[parameter.id] = fixedValue;
      continue;
    }
    const value = next[parameter.id] ?? parameter.defaultValue;
    let valid = value !== undefined;
    if (parameter.type === "select") {
      valid = valid && (
        !!parameter.options?.some((option) => option.value === value)
        || acceptsCustomModelParameterValue(parameter, value)
      );
    } else if (parameter.type === "number" || parameter.type === "slider") {
      valid = typeof value === "number" && Number.isFinite(value)
        && (parameter.min === undefined || value >= parameter.min)
        && (parameter.max === undefined || value <= parameter.max);
    } else if (parameter.type === "boolean") {
      valid = typeof value === "boolean";
    } else if (parameter.type === "text") {
      valid = typeof value === "string";
    }
    if (valid) continue;
    const fallback = card.defaultParams[parameter.id] ?? parameter.defaultValue;
    if (fallback !== undefined) next[parameter.id] = fallback;
    else delete next[parameter.id];
  }
  return next;
}
