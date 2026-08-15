import type { LoroDoc } from "loro-crdt";
import { z } from "zod";

import {
  advanceProjectGeneratorHead,
  createProjectGenerator as createProjectGeneratorFact,
  ExecutablePluginJsonValueSchema,
  GeneratorDefinitionSchema,
  GeneratorInputRefSchema,
  GeneratorRevisionRefSchema,
  readGeneratorRevision,
  readDocumentAssetRevision,
  readOutputCommit,
  readProjectActionRun,
  readProjectAsset,
  readProjectGenerator,
  type ActionRunRequest,
  type ExecutablePluginInvocation,
  type ExecutablePluginJsonValue,
  type ExecutablePluginReference,
  type GeneratorDefinition,
  type GeneratorInputRef,
  type GeneratorRevision,
  type GeneratorRevisionRef,
  type ProjectGenerator,
} from "@clash/shared-types";

import {
  buildLocalGeneratorActionRun,
  validateLocalGeneratorRevisionContract,
  type BuiltLocalGeneratorActionRun,
} from "./local-generator-contract.js";
import {
  DEFAULT_LOCAL_PROVIDER_RUN_DEADLINE_MS,
  type LocalDurableRunCreateCommand,
} from "./durable-run-coordinator.js";
import type { SqliteDurableRunJournal } from "./durable-run-journal.js";
import { createLocalGeneratorRunBridge } from "./local-generator-run-bridge.js";

export interface LocalGeneratorProjectAuthority {
  inspect<T>(
    projectId: string,
    read: (doc: LoroDoc) => T | Promise<T>,
  ): Promise<T>;
  mutate<T>(
    projectId: string,
    mutation: (doc: LoroDoc, checkpoint: () => Promise<void>) => T | Promise<T>,
  ): Promise<T>;
}

export class LocalGeneratorProductError extends Error {
  override name = "LocalGeneratorProductError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const jsonObjectSchema = z
  .record(z.string(), z.unknown())
  .transform((value, context): Record<string, ExecutablePluginJsonValue> => {
    const parsed: Record<string, ExecutablePluginJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const result = ExecutablePluginJsonValueSchema.safeParse(entry);
      if (!result.success) {
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            result.error.issues[0]?.message ?? "Invalid plugin JSON value.",
        });
        return z.NEVER;
      }
      parsed[key] = result.data;
    }
    return parsed;
  });

const generatorInputRefsSchema = z
  .array(z.unknown())
  .transform((value, context): GeneratorInputRef[] => {
    const result = GeneratorInputRefSchema.array().safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0];
      context.addIssue({
        code: "custom",
        path: issue?.path ?? [],
        message: issue?.message ?? "Invalid Generator input reference.",
      });
      return z.NEVER;
    }
    return result.data;
  });

const generatorRevisionRefSchema = z
  .unknown()
  .transform((value, context): GeneratorRevisionRef => {
    const result = GeneratorRevisionRefSchema.safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0];
      context.addIssue({
        code: "custom",
        path: issue?.path ?? [],
        message: issue?.message ?? "Invalid Generator revision reference.",
      });
      return z.NEVER;
    }
    return result.data;
  });

export const CreateLocalProjectGeneratorInputSchema = z
  .object({
    generatorId: z.string().trim().min(1),
    generatorRevisionId: z.string().trim().min(1),
    pluginId: z.string().trim().min(1),
    definitionId: z.string().trim().min(1),
    state: jsonObjectSchema,
    persistentInputRefs: generatorInputRefsSchema.default([]),
    forkedFrom: generatorRevisionRefSchema.optional(),
  })
  .strict();
export type CreateLocalProjectGeneratorInput = z.infer<
  typeof CreateLocalProjectGeneratorInputSchema
>;

export const SubmitLocalGeneratorActionInputSchema = z
  .object({
    actionRunId: z.string().trim().min(1),
    generatorRevisionId: z.string().trim().min(1),
    parameters: jsonObjectSchema.default({}),
    invocationInputRefs: generatorInputRefsSchema.default([]),
  })
  .strict();
export type SubmitLocalGeneratorActionInput = z.infer<
  typeof SubmitLocalGeneratorActionInputSchema
>;

export const AdvanceLocalProjectGeneratorInputSchema = z
  .object({
    expectedHeadRevisionId: z.string().trim().min(1),
    generatorRevisionId: z.string().trim().min(1),
    state: jsonObjectSchema,
    persistentInputRefs: generatorInputRefsSchema.default([]),
  })
  .strict();
export type AdvanceLocalProjectGeneratorInput = z.infer<
  typeof AdvanceLocalProjectGeneratorInputSchema
>;

export interface LocalProjectGeneratorProjection {
  generator: ProjectGenerator;
  revision: GeneratorRevision;
}

function semanticDefinitionRef(definition: GeneratorDefinition) {
  return {
    pluginId: definition.pluginId,
    definitionId: definition.definitionId,
    version: definition.version,
    schemaHash: definition.schemaHash,
  };
}

function requireResolvedDefinition(
  requested: { pluginId: string; definitionId: string },
  input: unknown,
): GeneratorDefinition {
  const definition = GeneratorDefinitionSchema.parse(input);
  if (
    definition.pluginId !== requested.pluginId ||
    definition.definitionId !== requested.definitionId
  ) {
    throw new LocalGeneratorProductError(
      "GENERATOR_DEFINITION_MISMATCH",
      "The Plugin Host resolved a different Generator definition.",
    );
  }
  return definition;
}

function pluginReferences(
  doc: LoroDoc,
  refs: readonly GeneratorInputRef[],
): ExecutablePluginReference[] {
  const indexes = new Map<string, number>();
  return refs.map((ref) => {
    const index = indexes.get(ref.slot) ?? 0;
    indexes.set(ref.slot, index + 1);
    const target = ref.target;
    if ("kind" in target && target.kind === "media") {
      const asset = readProjectAsset(doc, target.projectAssetId);
      if (!asset) {
        throw new LocalGeneratorProductError(
          "GENERATOR_INPUT_NOT_FOUND",
          `Project Asset ${target.projectAssetId} not found.`,
        );
      }
      return {
        slot: ref.slot,
        index,
        asset: {
          assetId: asset.id,
          uri: `clash-asset://${asset.id}`,
          kind: asset.kind,
          ...(asset.metadata.contentType
            ? { mediaType: asset.metadata.contentType }
            : {}),
        },
      };
    }
    if ("kind" in target && target.kind === "document") {
      const revision = readDocumentAssetRevision(doc, target);
      if (!revision) {
        throw new LocalGeneratorProductError(
          "GENERATOR_INPUT_NOT_FOUND",
          `Document revision ${target.documentAssetId}/${target.revisionId} not found.`,
        );
      }
      return {
        slot: ref.slot,
        index,
        document: {
          documentAssetId: revision.documentAssetId,
          revisionId: revision.id,
          documentKind: revision.documentKind,
          schemaVersion: revision.schemaVersion,
        },
      };
    }
    throw new LocalGeneratorProductError(
      "GENERATOR_INPUT_UNSUPPORTED",
      "Generator-family executable references are not supported by this Host yet.",
    );
  });
}

function outputFileExtension(
  output: BuiltLocalGeneratorActionRun["action"]["outputs"][number],
): string {
  if (output.assetType.kind === "document") return "json";
  if (output.assetType.mediaKind === "image") return "png";
  if (output.assetType.mediaKind === "video") return "mp4";
  return "wav";
}

/**
 * The sole public-Run -> private-task translation. Every semantic field comes
 * from the already validated, Host-resolved Generator contract.
 */
export function buildLocalGeneratorDurableRunCommand(input: {
  doc: LoroDoc;
  projectId: string;
  built: BuiltLocalGeneratorActionRun;
  actor: ExecutablePluginInvocation["actor"];
  deadlineAt: number;
}): LocalDurableRunCreateCommand {
  const output = input.built.action.outputs[0]!;
  const allRefs = [
    ...input.built.revision.persistentInputRefs,
    ...input.built.request.invocationInputRefs,
  ];
  const prompt = input.built.revision.state.prompt;
  return {
    type: "create",
    actionRunId: input.built.request.actionRunId,
    outputSlot: output.slot,
    deadlineAt: input.deadlineAt,
    executor: {
      targetKind: "generator-action",
      binding: input.built.request.executor,
      actionId: input.built.action.id,
      actor: input.actor,
      publicOwner: {
        actionId: input.built.revision.generatorId,
        actionRevisionId: input.built.revision.id,
      },
      generatorOutputContract: input.built.request.outputContract,
      kind:
        output.assetType.kind === "media" ? output.assetType.mediaKind : "text",
      projectId: input.projectId,
      ...(output.assetType.kind === "media"
        ? {
            delivery: {
              kind: "project-asset" as const,
              actionId: input.built.revision.generatorId,
              name:
                `${input.built.revision.generatorId}-` +
                `${input.built.request.actionRunId}.${outputFileExtension(output)}`,
              ...(typeof prompt === "string" ? { prompt } : {}),
            },
          }
        : {}),
      input: {
        values: {
          ...input.built.revision.state,
          ...input.built.request.parameters,
        },
        references: pluginReferences(input.doc, allRefs),
      },
    },
  };
}

export function createLocalGeneratorProductService(options: {
  authority: LocalGeneratorProjectAuthority;
  resolveDefinition: (
    pluginId: string,
    definitionId: string,
  ) => Promise<GeneratorDefinition>;
  ownerId: string;
  journal: SqliteDurableRunJournal;
  actor: ExecutablePluginInvocation["actor"];
  deadlineMs?: number;
  now?: () => number;
}) {
  const bridge = createLocalGeneratorRunBridge({
    ownerId: options.ownerId,
    journal: options.journal,
  });
  const deadlineMs =
    options.deadlineMs ?? DEFAULT_LOCAL_PROVIDER_RUN_DEADLINE_MS;
  const now = options.now ?? Date.now;
  return {
    async create(
      projectId: string,
      inputRaw: CreateLocalProjectGeneratorInput,
    ): Promise<LocalProjectGeneratorProjection & { changed: boolean }> {
      const input = CreateLocalProjectGeneratorInputSchema.parse(inputRaw);
      const definition = requireResolvedDefinition(
        input,
        await options.resolveDefinition(input.pluginId, input.definitionId),
      );
      const revision: GeneratorRevision = {
        id: input.generatorRevisionId,
        generatorId: input.generatorId,
        definitionRef: semanticDefinitionRef(definition),
        state: input.state,
        persistentInputRefs: input.persistentInputRefs,
        ...(input.forkedFrom ? { forkedFrom: input.forkedFrom } : {}),
      };
      return options.authority.mutate(projectId, async (doc, checkpoint) => {
        const validatedRevision = validateLocalGeneratorRevisionContract({
          doc,
          definition,
          revision,
        });
        const result = createProjectGeneratorFact(doc, {
          head: {
            id: input.generatorId,
            headRevisionId: input.generatorRevisionId,
          },
          revision: validatedRevision,
        });
        if (!result.ok) {
          throw new LocalGeneratorProductError(
            result.error.code,
            result.error.message,
          );
        }
        if (result.changed) await checkpoint();
        return result;
      });
    },

    async read(
      projectId: string,
      generatorId: string,
    ): Promise<LocalProjectGeneratorProjection | null> {
      return options.authority.inspect(projectId, (doc) => {
        const generator = readProjectGenerator(doc, generatorId);
        if (!generator) return null;
        const revision = readGeneratorRevision(doc, {
          generatorId: generator.id,
          generatorRevisionId: generator.headRevisionId,
        });
        return revision ? { generator, revision } : null;
      });
    },

    async advance(
      projectId: string,
      generatorId: string,
      inputRaw: AdvanceLocalProjectGeneratorInput,
    ): Promise<LocalProjectGeneratorProjection & { changed: boolean }> {
      const input = AdvanceLocalProjectGeneratorInputSchema.parse(inputRaw);
      return options.authority.mutate(projectId, async (doc, checkpoint) => {
        const generator = readProjectGenerator(doc, generatorId);
        if (!generator) {
          throw new LocalGeneratorProductError(
            "PROJECT_GENERATOR_NOT_FOUND",
            `Project Generator ${generatorId} not found.`,
          );
        }
        if (
          generator.headRevisionId !== input.expectedHeadRevisionId &&
          generator.headRevisionId !== input.generatorRevisionId
        ) {
          throw new LocalGeneratorProductError(
            "STALE_GENERATOR_HEAD",
            `Project Generator ${generatorId} changed after it was read.`,
          );
        }
        const currentRevision = readGeneratorRevision(doc, {
          generatorId,
          generatorRevisionId: generator.headRevisionId,
        });
        if (!currentRevision) {
          throw new LocalGeneratorProductError(
            "GENERATOR_REVISION_NOT_FOUND",
            `Generator revision ${generatorId}/${generator.headRevisionId} not found.`,
          );
        }
        const definition = requireResolvedDefinition(
          currentRevision.definitionRef,
          await options.resolveDefinition(
            currentRevision.definitionRef.pluginId,
            currentRevision.definitionRef.definitionId,
          ),
        );
        const revision = validateLocalGeneratorRevisionContract({
          doc,
          definition,
          revision: {
            id: input.generatorRevisionId,
            generatorId,
            definitionRef: currentRevision.definitionRef,
            parentRevisionId: input.expectedHeadRevisionId,
            state: input.state,
            persistentInputRefs: input.persistentInputRefs,
          },
        });
        const result = advanceProjectGeneratorHead(doc, {
          generatorId,
          expectedHeadRevisionId: input.expectedHeadRevisionId,
          revision,
          editPolicy: definition.editPolicy,
        });
        if (!result.ok) {
          throw new LocalGeneratorProductError(
            result.error.code,
            result.error.message,
          );
        }
        if (result.changed) await checkpoint();
        return result;
      });
    },

    async submit(
      projectId: string,
      generatorId: string,
      actionId: string,
      inputRaw: SubmitLocalGeneratorActionInput,
    ) {
      const input = SubmitLocalGeneratorActionInputSchema.parse(inputRaw);
      return options.authority.mutate(projectId, async (doc, checkpoint) => {
        const generator = readProjectGenerator(doc, generatorId);
        if (!generator) {
          throw new LocalGeneratorProductError(
            "PROJECT_GENERATOR_NOT_FOUND",
            `Project Generator ${generatorId} not found.`,
          );
        }
        const frozenRevision = readGeneratorRevision(doc, {
          generatorId,
          generatorRevisionId: input.generatorRevisionId,
        });
        if (!frozenRevision) {
          throw new LocalGeneratorProductError(
            "GENERATOR_REVISION_NOT_FOUND",
            `Generator revision ${generatorId}/${input.generatorRevisionId} not found.`,
          );
        }
        const definition = requireResolvedDefinition(
          frozenRevision.definitionRef,
          await options.resolveDefinition(
            frozenRevision.definitionRef.pluginId,
            frozenRevision.definitionRef.definitionId,
          ),
        );
        const built = buildLocalGeneratorActionRun({
          doc,
          definition,
          actionRunId: input.actionRunId,
          generatorRevision: {
            generatorId,
            generatorRevisionId: input.generatorRevisionId,
          },
          actionId,
          parameters: input.parameters,
          invocationInputRefs: input.invocationInputRefs,
        });
        const outputSlot = built.action.outputs[0]!.slot;
        const existingTask = await options.journal.load({
          actionRunId: input.actionRunId,
          outputSlot,
        });
        const command = buildLocalGeneratorDurableRunCommand({
          doc,
          projectId,
          built,
          actor: options.actor,
          deadlineAt: existingTask?.deadlineAt ?? now() + deadlineMs,
        });
        return bridge.enqueue({
          doc,
          request: built.request,
          command,
          checkpoint,
        });
      });
    },

    async readRun(
      projectId: string,
      actionRunId: string,
    ): Promise<ReturnType<typeof readProjectActionRun>> {
      return options.authority.inspect(projectId, (doc) =>
        readProjectActionRun(doc, actionRunId),
      );
    },

    async readOutput(
      projectId: string,
      input: { actionRunId: string; outputSlot: string },
    ): Promise<ReturnType<typeof readOutputCommit>> {
      return options.authority.inspect(projectId, (doc) =>
        readOutputCommit(doc, input),
      );
    },
  };
}

export type LocalGeneratorProductService = ReturnType<
  typeof createLocalGeneratorProductService
>;
