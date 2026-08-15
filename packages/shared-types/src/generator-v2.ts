import { z } from "zod";

import { AssetKindSchema } from "./assets.js";
import { ExecutablePluginJsonValueSchema } from "./plugin-json-value.js";
import { pluginIdSchema } from "./plugin-namespace.js";

const nonEmptyIdSchema = z.string().trim().min(1);
const prefixedSha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const jsonObjectSchema = z.record(ExecutablePluginJsonValueSchema);

export const GeneratorEditPolicySchema = z.enum([
  "advance-head",
  "fork-when-materialized",
]);
export type GeneratorEditPolicy = z.infer<typeof GeneratorEditPolicySchema>;

export const MediaAssetRevisionRefSchema = z
  .object({
    kind: z.literal("media"),
    projectAssetId: nonEmptyIdSchema,
  })
  .strict();
export type MediaAssetRevisionRef = z.infer<typeof MediaAssetRevisionRefSchema>;

export const DocumentAssetRevisionRefSchema = z
  .object({
    kind: z.literal("document"),
    documentAssetId: nonEmptyIdSchema,
    revisionId: nonEmptyIdSchema,
  })
  .strict();
export type DocumentAssetRevisionRef = z.infer<
  typeof DocumentAssetRevisionRefSchema
>;

export const AssetRevisionRefSchema = z.discriminatedUnion("kind", [
  MediaAssetRevisionRefSchema,
  DocumentAssetRevisionRefSchema,
]);
export type AssetRevisionRef = z.infer<typeof AssetRevisionRefSchema>;

export const GeneratorRevisionRefSchema = z
  .object({
    generatorId: nonEmptyIdSchema,
    generatorRevisionId: nonEmptyIdSchema,
  })
  .strict();
export type GeneratorRevisionRef = z.infer<typeof GeneratorRevisionRefSchema>;

export const GeneratorInputTargetSchema = z.union([
  AssetRevisionRefSchema,
  GeneratorRevisionRefSchema,
]);
export type GeneratorInputTarget = z.infer<typeof GeneratorInputTargetSchema>;

export const GeneratorInputRefSchema = z
  .object({
    slot: nonEmptyIdSchema,
    itemKey: nonEmptyIdSchema.optional(),
    target: GeneratorInputTargetSchema,
  })
  .strict();
export type GeneratorInputRef = z.infer<typeof GeneratorInputRefSchema>;

export const GeneratorDefinitionRefSchema = z
  .object({
    pluginId: pluginIdSchema,
    definitionId: nonEmptyIdSchema,
    version: nonEmptyIdSchema,
    schemaHash: prefixedSha256Schema,
  })
  .strict();
export type GeneratorDefinitionRef = z.infer<
  typeof GeneratorDefinitionRefSchema
>;

/**
 * The exact semantic function selected for one Run. Runtime placement, account
 * selection, process ids, and retry state are Host-private Task facts and are
 * deliberately absent.
 */
export const GeneratorExecutorRefSchema = z
  .object({
    pluginId: pluginIdSchema,
    version: nonEmptyIdSchema,
    exportId: nonEmptyIdSchema,
    schemaHash: prefixedSha256Schema,
  })
  .strict();
export type GeneratorExecutorRef = z.infer<typeof GeneratorExecutorRefSchema>;

export const GeneratorMediaAssetTypeSchema = z
  .object({
    kind: z.literal("media"),
    mediaKind: AssetKindSchema,
  })
  .strict();
export type GeneratorMediaAssetType = z.infer<
  typeof GeneratorMediaAssetTypeSchema
>;

export const GeneratorDocumentAssetTypeSchema = z
  .object({
    kind: z.literal("document"),
    documentKind: nonEmptyIdSchema,
    schemaVersion: z.number().int().positive(),
  })
  .strict();
export type GeneratorDocumentAssetType = z.infer<
  typeof GeneratorDocumentAssetTypeSchema
>;

export const GeneratorAssetTypeSchema = z.discriminatedUnion("kind", [
  GeneratorMediaAssetTypeSchema,
  GeneratorDocumentAssetTypeSchema,
]);
export type GeneratorAssetType = z.infer<typeof GeneratorAssetTypeSchema>;

export const GeneratorInputCardinalitySchema = z
  .object({
    minItems: z.number().int().nonnegative(),
    maxItems: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine(({ minItems, maxItems }, context) => {
    if (maxItems !== null && maxItems < minItems) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxItems"],
        message: "maxItems must be greater than or equal to minItems.",
      });
    }
  });
export type GeneratorInputCardinality = z.infer<
  typeof GeneratorInputCardinalitySchema
>;

export const GeneratorActionInputCardinalitySchema =
  GeneratorInputCardinalitySchema;
export type GeneratorActionInputCardinality = GeneratorInputCardinality;

export const GeneratorFamilyInputTypeSchema = z
  .object({
    kind: z.literal("generator"),
    pluginId: pluginIdSchema,
    definitionId: nonEmptyIdSchema,
  })
  .strict();
export type GeneratorFamilyInputType = z.infer<
  typeof GeneratorFamilyInputTypeSchema
>;

export const GeneratorInputTypeSchema = z.discriminatedUnion("kind", [
  GeneratorMediaAssetTypeSchema,
  GeneratorDocumentAssetTypeSchema,
  GeneratorFamilyInputTypeSchema,
]);
export type GeneratorInputType = z.infer<typeof GeneratorInputTypeSchema>;

export const GeneratorInputPortSchema = z
  .object({
    slot: nonEmptyIdSchema,
    accepts: z.array(GeneratorInputTypeSchema).min(1),
    cardinality: GeneratorInputCardinalitySchema,
  })
  .strict();
export type GeneratorInputPort = z.infer<typeof GeneratorInputPortSchema>;

export const GeneratorActionInputPortSchema = GeneratorInputPortSchema;
export type GeneratorActionInputPort = GeneratorInputPort;

export const GeneratorActionOutputCardinalitySchema =
  GeneratorInputCardinalitySchema;
export type GeneratorActionOutputCardinality = GeneratorInputCardinality;

export const GeneratorActionOutputPortSchema = z
  .object({
    slot: nonEmptyIdSchema,
    assetType: GeneratorAssetTypeSchema,
    cardinality: GeneratorActionOutputCardinalitySchema,
  })
  .strict();
export type GeneratorActionOutputPort = z.infer<
  typeof GeneratorActionOutputPortSchema
>;

export const GeneratorActionOutputContractSchema = z
  .array(GeneratorActionOutputPortSchema)
  .length(1)
  .superRefine((outputs, context) => {
    const cardinality = outputs[0]?.cardinality;
    if (cardinality?.minItems !== 1 || cardinality.maxItems !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [0, "cardinality"],
        message:
          "The current Generator Action profile requires exactly one output.",
      });
    }
  });
export type GeneratorActionOutputContract = z.infer<
  typeof GeneratorActionOutputContractSchema
>;

export const GeneratorActionDefinitionSchema = z
  .object({
    id: nonEmptyIdSchema,
    executorExportId: nonEmptyIdSchema,
    parametersSchema: jsonObjectSchema,
    invocationInputs: z.array(GeneratorActionInputPortSchema),
    outputs: GeneratorActionOutputContractSchema,
  })
  .strict()
  .superRefine(({ invocationInputs }, context) => {
    const seen = new Set<string>();
    invocationInputs.forEach((input, index) => {
      if (seen.has(input.slot)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["invocationInputs", index, "slot"],
          message: `Duplicate Generator Action input slot: ${input.slot}`,
        });
      }
      seen.add(input.slot);
    });
  });
export type GeneratorActionDefinition = z.infer<
  typeof GeneratorActionDefinitionSchema
>;

const generatorDefinitionSpecShape = {
  definitionId: nonEmptyIdSchema,
  stateSchema: jsonObjectSchema,
  editPolicy: GeneratorEditPolicySchema,
  persistentInputs: z.array(GeneratorInputPortSchema),
  actions: z.array(GeneratorActionDefinitionSchema).min(1),
} as const;

function validateGeneratorDefinitionSpec(
  input: {
    actions: readonly GeneratorActionDefinition[];
    persistentInputs: readonly GeneratorInputPort[];
  },
  context: z.RefinementCtx,
): void {
  const persistentSlots = new Set<string>();
  input.persistentInputs.forEach((persistentInput, index) => {
    if (persistentSlots.has(persistentInput.slot)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["persistentInputs", index, "slot"],
        message: `Duplicate Generator persistent input slot: ${persistentInput.slot}`,
      });
    }
    persistentSlots.add(persistentInput.slot);
  });

  const actionIds = new Set<string>();
  input.actions.forEach((action, index) => {
    if (actionIds.has(action.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", index, "id"],
        message: `Duplicate Generator action id: ${action.id}`,
      });
    }
    actionIds.add(action.id);
  });
}

/** Plugin-authored semantic definition before the Host injects package provenance. */
export const GeneratorDefinitionSpecSchema = z
  .object(generatorDefinitionSpecShape)
  .strict()
  .superRefine(validateGeneratorDefinitionSpec);
export type GeneratorDefinitionSpec = z.infer<
  typeof GeneratorDefinitionSpecSchema
>;

export const GeneratorDefinitionSchema = GeneratorDefinitionRefSchema.extend({
  stateSchema: generatorDefinitionSpecShape.stateSchema,
  editPolicy: generatorDefinitionSpecShape.editPolicy,
  persistentInputs: generatorDefinitionSpecShape.persistentInputs,
  actions: generatorDefinitionSpecShape.actions,
})
  .strict()
  .superRefine(validateGeneratorDefinitionSpec);
export type GeneratorDefinition = z.infer<typeof GeneratorDefinitionSchema>;

/** Persisted mutable Project identity. The definition is derived from its immutable head revision. */
export const ProjectGeneratorHeadSchema = z
  .object({
    id: nonEmptyIdSchema,
    headRevisionId: nonEmptyIdSchema,
  })
  .strict();
export type ProjectGeneratorHead = z.infer<typeof ProjectGeneratorHeadSchema>;

/** Read projection joining the persisted head with its immutable revision definition. */
export const ProjectGeneratorSchema = ProjectGeneratorHeadSchema.extend({
  definitionRef: GeneratorDefinitionRefSchema,
}).strict();
export type ProjectGenerator = z.infer<typeof ProjectGeneratorSchema>;

export const GeneratorRevisionSchema = z
  .object({
    id: nonEmptyIdSchema,
    generatorId: nonEmptyIdSchema,
    definitionRef: GeneratorDefinitionRefSchema,
    parentRevisionId: nonEmptyIdSchema.optional(),
    forkedFrom: GeneratorRevisionRefSchema.optional(),
    state: jsonObjectSchema,
    persistentInputRefs: z.array(GeneratorInputRefSchema),
  })
  .strict()
  .superRefine(({ generatorId, forkedFrom }, context) => {
    if (forkedFrom?.generatorId === generatorId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["forkedFrom", "generatorId"],
        message:
          "Same-Generator ancestry belongs in parentRevisionId, not forkedFrom.",
      });
    }
  });
export type GeneratorRevision = z.infer<typeof GeneratorRevisionSchema>;

export const ActionRunStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
]);
export type ActionRunStatus = z.infer<typeof ActionRunStatusSchema>;

export const ActionRunRequestSchema = z
  .object({
    actionRunId: nonEmptyIdSchema,
    generatorRevision: GeneratorRevisionRefSchema,
    actionId: nonEmptyIdSchema,
    executor: GeneratorExecutorRefSchema,
    invocationFingerprint: prefixedSha256Schema,
    parameters: jsonObjectSchema,
    invocationInputRefs: z.array(GeneratorInputRefSchema),
    outputContract: GeneratorActionOutputContractSchema,
  })
  .strict();
export type ActionRunRequest = z.infer<typeof ActionRunRequestSchema>;

export const ActionRunOutcomeSchema = z
  .object({
    actionRunId: nonEmptyIdSchema,
    status: z.enum(["succeeded", "failed"]),
  })
  .strict();
export type ActionRunOutcome = z.infer<typeof ActionRunOutcomeSchema>;

/** Read projection joining an immutable Run request with its coarse public state. */
export const ProjectActionRunSchema = ActionRunRequestSchema.extend({
  status: ActionRunStatusSchema,
}).strict();
export type ProjectActionRun = z.infer<typeof ProjectActionRunSchema>;

/** @deprecated Compatibility alias; persist ActionRunRequest and ActionRunOutcome instead. */
export const ActionRunSchema = ProjectActionRunSchema;
export type ActionRun = ProjectActionRun;

export const OutputCommitSchema = z
  .object({
    actionRunId: nonEmptyIdSchema,
    outputSlot: nonEmptyIdSchema,
    itemKey: nonEmptyIdSchema.optional(),
    asset: AssetRevisionRefSchema,
  })
  .strict();
export type OutputCommit = z.infer<typeof OutputCommitSchema>;
