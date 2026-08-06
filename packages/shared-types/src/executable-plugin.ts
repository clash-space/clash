import { z } from "zod";

import { AssetKindSchema } from "./assets";
import {
  ModelCardSchema,
  ModelConstraintRuleSchema,
  ModelInputRuleSchema,
  ModelParameterSchema,
  type ModelCard,
} from "./models";

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isSafePluginRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.startsWith("\\")) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export const PluginRelativePathSchema = z.string().trim().min(1).refine(
  isSafePluginRelativePath,
  "Plugin paths must be relative and cannot contain dot segments.",
);

export const ExecutablePluginRuntimeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local"),
    transport: z.literal("stdio"),
    entrypoint: PluginRelativePathSchema,
    args: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("hosted"),
    transport: z.literal("http"),
    endpoint: z.string().url(),
  }),
]);

export const ExecutablePluginCardExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.enum(["model-card", "action-card"]),
  path: PluginRelativePathSchema,
});

export const ExecutableActionPresentationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("form"),
  }).strict(),
  z.object({
    type: z.literal("dialog"),
    size: z.enum(["sm", "md", "lg", "xl"]).default("lg"),
    title: z.string().trim().min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal("workspace"),
    resourceUri: z.string().regex(/^ui:\/\/[a-z0-9][a-z0-9._/-]*$/),
  }).strict(),
]);

export const ExecutableActionCardSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  parameters: z.array(ModelParameterSchema).default([]),
  outputType: z.enum(["image", "video", "audio", "text"]),
  input: ModelInputRuleSchema.default({
    requiresPrompt: true,
    inputMode: {},
    promptModalities: ["text"],
  }),
  constraints: z.array(ModelConstraintRuleSchema).optional(),
  presentation: ExecutableActionPresentationSchema.default({ type: "form" }),
  functionExportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  maxRuntimeMs: z.number().int().positive().optional(),
}).strict().superRefine((action, ctx) => {
  const parameterIds = new Set<string>();
  for (const [index, parameter] of action.parameters.entries()) {
    if (parameterIds.has(parameter.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "id"],
        message: "Action parameter ids must be unique.",
      });
    }
    parameterIds.add(parameter.id);

    if (parameter.type === "select") {
      const candidates = parameter.options?.map((option) => option.value) ?? [];
      if (candidates.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "options"],
          message: "Select parameters require at least one candidate.",
        });
      }
      if (new Set(candidates.map((value) => `${typeof value}:${String(value)}`)).size !== candidates.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "options"],
          message: "Select parameter candidate values must be unique.",
        });
      }
      if (parameter.defaultValue !== undefined && !candidates.some((value) => value === parameter.defaultValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "defaultValue"],
          message: `${parameter.label} defaultValue must be one of its configured candidates.`,
        });
      }
    }
    if (parameter.readOnly && parameter.defaultValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "defaultValue"],
        message: `${parameter.label} is read-only and requires a fixed default.`,
      });
    }
    if ((parameter.type === "number" || parameter.type === "slider") && parameter.defaultValue !== undefined) {
      if (typeof parameter.defaultValue !== "number" || !Number.isFinite(parameter.defaultValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "defaultValue"],
          message: `${parameter.label} default must be a finite number.`,
        });
      } else if (
        (parameter.min !== undefined && parameter.defaultValue < parameter.min)
        || (parameter.max !== undefined && parameter.defaultValue > parameter.max)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "defaultValue"],
          message: `${parameter.label} default must stay within its configured range.`,
        });
      }
    }
    if (parameter.type === "boolean" && parameter.defaultValue !== undefined && typeof parameter.defaultValue !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "defaultValue"],
        message: `${parameter.label} default must be a boolean.`,
      });
    }
  }

  const validateConstraintField = (field: string, path: Array<string | number>) => {
    if (!field.startsWith("modelParams.")) return;
    if (parameterIds.has(field.slice("modelParams.".length))) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `Action constraint ${field} must reference a declared parameter.`,
    });
  };
  for (const [index, rule] of (action.constraints ?? []).entries()) {
    if (rule.type === "mutually-exclusive") {
      rule.fields.forEach((field, fieldIndex) =>
        validateConstraintField(field, ["constraints", index, "fields", fieldIndex]));
      continue;
    }
    validateConstraintField(rule.field, ["constraints", index, "field"]);
    if (rule.type === "required") {
      rule.when.forEach((condition, conditionIndex) =>
        validateConstraintField(condition.field, ["constraints", index, "when", conditionIndex, "field"]));
    }
  }
});

export const ExecutablePluginCardDocumentSchema = z.discriminatedUnion("kind", [
  z.object({
    apiVersion: z.literal("clash.card/v1"),
    kind: z.literal("model-card"),
    spec: ModelCardSchema,
  }).strict(),
  z.object({
    apiVersion: z.literal("clash.card/v1"),
    kind: z.literal("action-card"),
    spec: ExecutableActionCardSchema,
  }).strict(),
]);

export const ExecutablePluginFunctionExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.enum(["action", "provider-projector"]),
  handler: z.string().trim().min(1),
});

const PluginNetworkPermissionsSchema = z.object({
  domains: z.array(z.string().trim().min(1)).default([]),
}).default({ domains: [] });

const PluginFilesystemPermissionsSchema = z.object({
  read: z.array(z.string().trim().min(1)).default([]),
  write: z.array(z.string().trim().min(1)).default([]),
}).default({ read: [], write: [] });

export const ExecutablePluginPermissionsSchema = z.object({
  network: PluginNetworkPermissionsSchema,
  secrets: z.array(z.string().trim().min(1)).default([]),
  assets: z.array(z.enum(["read", "write"])).default([]),
  hostTools: z.array(z.enum(["codex.imagegen"])).default([]),
  filesystem: PluginFilesystemPermissionsSchema,
  externalWrites: z.boolean().default(false),
}).default({
  network: { domains: [] },
  secrets: [],
  assets: [],
  hostTools: [],
  filesystem: { read: [], write: [] },
  externalWrites: false,
});

/** Activated Card plus the exact package provenance that supplied it. */
export const ExecutablePluginCardRegistrationSchema = z.object({
  pluginId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  version: z.string().trim().regex(SEMVER_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN),
  runtime: ExecutablePluginRuntimeSchema,
  permissions: ExecutablePluginPermissionsSchema,
  document: ExecutablePluginCardDocumentSchema,
}).strict();

/**
 * Interpret active plugin model Cards as the effective source of truth. Cards
 * replace a built-in with the same id, while new ids are appended. Projector
 * exports that omit an explicit owner are bound to the package provenance.
 */
export function composeExecutablePluginModelCards(
  baseModelsInput: readonly ModelCard[],
  registrationsInput: readonly ExecutablePluginCardRegistration[],
): ModelCard[] {
  const baseModels = z.array(ModelCardSchema).parse(baseModelsInput);
  const registrations = z.array(ExecutablePluginCardRegistrationSchema).parse(registrationsInput);
  const pluginModels = new Map<string, { pluginId: string; model: ModelCard }>();
  for (const registration of registrations) {
    if (registration.document.kind !== "model-card") continue;
    const id = registration.document.spec.id;
    const existing = pluginModels.get(id);
    if (existing) {
      throw new Error(
        `Plugins ${existing.pluginId} and ${registration.pluginId} both export model Card ${id}.`,
      );
    }
    const model = ModelCardSchema.parse({
      ...registration.document.spec,
      providerImplementations: registration.document.spec.providerImplementations?.map(
        (implementation) => implementation.projectorExportId && !implementation.projectorPluginId
          ? { ...implementation, projectorPluginId: registration.pluginId }
          : implementation,
      ),
    });
    pluginModels.set(id, { pluginId: registration.pluginId, model });
  }

  const baseIds = new Set(baseModels.map((model) => model.id));
  return [
    ...baseModels.map((model) => pluginModels.get(model.id)?.model ?? model),
    ...[...pluginModels.values()]
      .map((entry) => entry.model)
      .filter((model) => !baseIds.has(model.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
  ];
}

/** Immutable reference stored with Canvas nodes and task invocations. */
export const ExecutablePluginBindingSchema = z.object({
  pluginId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  version: z.string().trim().regex(SEMVER_PATTERN),
  exportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN),
}).strict();

export type ExecutablePluginJsonValue =
  | null
  | boolean
  | number
  | string
  | ExecutablePluginJsonValue[]
  | { [key: string]: ExecutablePluginJsonValue };

export const ExecutablePluginJsonValueSchema: z.ZodType<ExecutablePluginJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(ExecutablePluginJsonValueSchema),
    z.record(ExecutablePluginJsonValueSchema),
  ]),
);

export const ExecutablePluginAssetHandleSchema = z.object({
  assetId: z.string().trim().min(1),
  uri: z.string().regex(/^clash-asset:\/\/.+/),
  kind: AssetKindSchema,
  mediaType: z.string().trim().min(1).optional(),
}).strict();

const ExecutablePluginReferenceBaseSchema = z.object({
  slot: z.string().trim().min(1),
  index: z.number().int().nonnegative(),
});

export const ExecutablePluginReferenceSchema = z.union([
  ExecutablePluginReferenceBaseSchema.extend({
    asset: ExecutablePluginAssetHandleSchema,
  }).strict(),
  ExecutablePluginReferenceBaseSchema.extend({
    text: z.object({
      nodeId: z.string().trim().min(1),
      value: z.string(),
    }).strict(),
  }).strict(),
]);

export const ExecutablePluginInvocationSchema = z.object({
  protocol: z.literal("clash.plugin.invoke/v1"),
  invocationId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  nodeId: z.string().trim().min(1).optional(),
  target: ExecutablePluginBindingSchema.extend({
    kind: z.enum(["action", "provider-projector"]),
  }),
  input: z.object({
    values: z.record(ExecutablePluginJsonValueSchema).default({}),
    references: z.array(ExecutablePluginReferenceSchema).default([]),
  }).strict(),
  actor: z.object({
    kind: z.enum(["user", "agent", "system"]),
    id: z.string().trim().min(1).optional(),
  }).strict(),
}).strict();

/** Signed, short-lived authorization context passed to hosted functions in headers. */
export const HostedExecutablePluginCapabilitySchema = z.object({
  protocol: z.literal("clash.plugin.hosted-capability/v1"),
  capabilityId: z.string().trim().min(1),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  endpoint: z.string().url(),
  ownerUserId: z.string().trim().min(1),
  invocation: z.object({
    invocationId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    nodeId: z.string().trim().min(1).optional(),
    target: ExecutablePluginBindingSchema.extend({
      kind: z.enum(["action", "provider-projector"]),
    }),
    actor: z.object({
      kind: z.enum(["user", "agent", "system"]),
      id: z.string().trim().min(1).optional(),
    }).strict(),
  }).strict(),
  permissions: ExecutablePluginPermissionsSchema,
}).strict().superRefine((capability, ctx) => {
  if (capability.expiresAt <= capability.issuedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Hosted plugin capability must expire after it is issued.",
    });
  }
  if (capability.expiresAt - capability.issuedAt > 60 * 60) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Hosted plugin capability lifetime cannot exceed one hour.",
    });
  }
});

export const ExecutablePluginOutputSchema = z.union([
  z.object({
    slot: z.string().trim().min(1),
    kind: z.literal("asset"),
    asset: ExecutablePluginAssetHandleSchema,
  }).strict(),
  z.object({
    slot: z.string().trim().min(1),
    kind: z.literal("value"),
    value: ExecutablePluginJsonValueSchema,
  }).strict(),
]);

export const ExecutablePluginResultSchema = z.discriminatedUnion("status", [
  z.object({
    protocol: z.literal("clash.plugin.result/v1"),
    invocationId: z.string().trim().min(1),
    status: z.literal("completed"),
    outputs: z.array(ExecutablePluginOutputSchema).default([]),
  }).strict(),
  z.object({
    protocol: z.literal("clash.plugin.result/v1"),
    invocationId: z.string().trim().min(1),
    status: z.literal("failed"),
    error: z.object({
      code: z.string().trim().min(1),
      message: z.string().trim().min(1),
      retryable: z.boolean().default(false),
      details: ExecutablePluginJsonValueSchema.optional(),
    }).strict(),
  }).strict(),
]);

export const ExecutablePluginBrokerOperationSchema = z.union([
  z.object({
    kind: z.literal("credential.handle"),
    secretId: z.string().trim().min(1),
  }).strict(),
  z.object({
    kind: z.literal("asset.read"),
    asset: ExecutablePluginAssetHandleSchema,
  }).strict(),
  z.object({
    kind: z.literal("asset.write"),
    slot: z.string().trim().min(1),
    assetKind: AssetKindSchema,
    mediaType: z.string().trim().min(1).optional(),
    sourceHandle: z.string().regex(/^clash-plugin-output:\/\/.+/).optional(),
    dataBase64: z.string().max(128 * 1024 * 1024).regex(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      "Plugin asset data must be canonical base64.",
    ).optional(),
  }).strict().superRefine((operation, ctx) => {
    if (Boolean(operation.sourceHandle) === Boolean(operation.dataBase64)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "asset.write requires exactly one of sourceHandle or dataBase64.",
      });
    }
  }),
  z.object({
    kind: z.literal("network.fetch"),
    url: z.string().url(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    headers: z.record(z.string()).default({}),
    body: ExecutablePluginJsonValueSchema.optional(),
    credentialHandle: z.string().regex(/^clash-secret:\/\/.+/).optional(),
  }).strict(),
  z.object({
    kind: z.literal("codex.image.generate"),
    prompt: z.string().trim().min(1).max(20_000),
    aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]).default("1:1"),
    slot: z.string().trim().min(1),
    references: z.array(ExecutablePluginAssetHandleSchema.extend({
      kind: z.literal("image"),
    }).strict()).max(5).default([]),
  }).strict(),
]);

export const ExecutablePluginBrokerRequestSchema = z.object({
  protocol: z.literal("clash.plugin.broker-request/v1"),
  requestId: z.string().trim().min(1),
  invocationId: z.string().trim().min(1),
  operation: ExecutablePluginBrokerOperationSchema,
}).strict();

export const ExecutablePluginBrokerResponseSchema = z.discriminatedUnion("status", [
  z.object({
    protocol: z.literal("clash.plugin.broker-response/v1"),
    requestId: z.string().trim().min(1),
    status: z.literal("ok"),
    result: ExecutablePluginJsonValueSchema,
  }).strict(),
  z.object({
    protocol: z.literal("clash.plugin.broker-response/v1"),
    requestId: z.string().trim().min(1),
    status: z.literal("error"),
    error: z.object({
      code: z.string().trim().min(1),
      message: z.string().trim().min(1),
    }).strict(),
  }).strict(),
]);

const ExecutablePluginContractBrokerFixtureSchema = z.object({
  operation: ExecutablePluginBrokerOperationSchema,
  response: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      result: ExecutablePluginJsonValueSchema,
    }).strict(),
    z.object({
      status: z.literal("error"),
      error: z.object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
      }).strict(),
    }).strict(),
  ]),
}).strict();

/**
 * A deterministic, declarative executable-plugin contract test. Broker
 * fixtures are inert test data: running a contract test never grants access to
 * a real credential, asset, network destination, or external write.
 */
export const ExecutablePluginContractTestDocumentSchema = z.object({
  apiVersion: z.literal("clash.plugin.contract-test/v1"),
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  description: z.string().trim().min(1).optional(),
  target: z.object({
    exportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
    kind: z.enum(["action", "provider-projector"]),
  }).strict(),
  context: z.object({
    projectId: z.string().trim().min(1).default("contract-test-project"),
    nodeId: z.string().trim().min(1).optional(),
  }).strict().default({ projectId: "contract-test-project" }),
  input: z.object({
    values: z.record(ExecutablePluginJsonValueSchema).default({}),
    references: z.array(ExecutablePluginReferenceSchema).default([]),
  }).strict(),
  brokerFixtures: z.array(ExecutablePluginContractBrokerFixtureSchema).default([]),
  expect: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("completed"),
      outputs: z.array(ExecutablePluginOutputSchema).default([]),
    }).strict(),
    z.object({
      status: z.literal("failed"),
      error: z.object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
        retryable: z.boolean().default(false),
        details: ExecutablePluginJsonValueSchema.optional(),
      }).strict(),
    }).strict(),
  ]),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000),
}).strict();

export const ExecutablePluginManifestSchema = z.object({
  apiVersion: z.literal("clash.plugin/v1"),
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  version: z.string().trim().regex(SEMVER_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  runtime: ExecutablePluginRuntimeSchema,
  exports: z.object({
    cards: z.array(ExecutablePluginCardExportSchema).default([]),
    functions: z.array(ExecutablePluginFunctionExportSchema).default([]),
  }),
  permissions: ExecutablePluginPermissionsSchema,
  contractTests: z.array(PluginRelativePathSchema).default([]),
  author: z.string().trim().min(1).optional(),
  repository: z.string().trim().min(1).optional(),
}).superRefine((manifest, ctx) => {
  for (const [key, values] of [
    ["cards", manifest.exports.cards],
    ["functions", manifest.exports.functions],
  ] as const) {
    const ids = new Set<string>();
    for (const value of values) {
      if (ids.has(value.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exports", key],
          message: `Plugin ${key} export ids must be unique.`,
        });
      }
      ids.add(value.id);
    }
  }
  const cardPaths = new Set<string>();
  for (const card of manifest.exports.cards) {
    if (cardPaths.has(card.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exports", "cards"],
        message: "Plugin Card export paths must be unique.",
      });
    }
    cardPaths.add(card.path);
  }
  const contractTestPaths = new Set<string>();
  for (const path of manifest.contractTests) {
    if (contractTestPaths.has(path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contractTests"],
        message: "Plugin contract test paths must be unique.",
      });
    }
    contractTestPaths.add(path);
  }
});

function executablePluginDomainAllowed(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return domains.some((entry) => {
    const domain = entry.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/**
 * Kernel policy shared by local stdio and hosted HTTP brokers. Keeping this in
 * the versioned contract package prevents the two runtimes from granting
 * subtly different capabilities for the same manifest.
 */
export function executablePluginBrokerPermissionError(
  manifestInput: unknown,
  requestInput: unknown,
): string | null {
  const manifest = ExecutablePluginManifestSchema.parse(manifestInput);
  const request = ExecutablePluginBrokerRequestSchema.parse(requestInput);
  const operation = request.operation;
  if (operation.kind === "credential.handle") {
    return manifest.permissions.secrets.includes(operation.secretId)
      ? null
      : `Secret ${operation.secretId} is not declared by plugin ${manifest.id}.`;
  }
  if (operation.kind === "asset.read") {
    return manifest.permissions.assets.includes("read")
      ? null
      : `Asset read is not declared by plugin ${manifest.id}.`;
  }
  if (operation.kind === "asset.write") {
    return manifest.permissions.assets.includes("write")
      ? null
      : `Asset write is not declared by plugin ${manifest.id}.`;
  }
  if (operation.kind === "codex.image.generate") {
    if (!manifest.permissions.hostTools.includes("codex.imagegen")) {
      return `Codex ImageGen is not declared by plugin ${manifest.id}.`;
    }
    if (!manifest.permissions.assets.includes("write")) {
      return `Codex ImageGen requires asset write permission for plugin ${manifest.id}.`;
    }
    if (operation.references.length > 0 && !manifest.permissions.assets.includes("read")) {
      return `Codex ImageGen references require asset read permission for plugin ${manifest.id}.`;
    }
    return null;
  }

  const hostname = new URL(operation.url).hostname;
  if (!executablePluginDomainAllowed(hostname, manifest.permissions.network.domains)) {
    return `Network domain ${hostname} is not declared by plugin ${manifest.id}.`;
  }
  if (operation.method !== "GET" && !manifest.permissions.externalWrites) {
    return `External writes are not declared by plugin ${manifest.id}.`;
  }
  return null;
}

/** Kernel-owned proof that one exact plugin directory passed activation. */
export const ExecutablePluginActivationReceiptSchema = z.object({
  apiVersion: z.literal("clash.plugin.activation/v1"),
  pluginId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  version: z.string().trim().regex(SEMVER_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN),
  contentHash: z.string().regex(SHA256_PATTERN),
  activatedAt: z.string().datetime(),
}).strict();

export interface ValidatedExecutablePluginPackage {
  manifest: ExecutablePluginManifest;
  cards: Record<string, ExecutablePluginCardDocument>;
  contractTests: Record<string, ExecutablePluginContractTestDocument>;
}

/** Strictly validates one unpacked plugin before it can become active. */
export function validateExecutablePluginPackage(
  manifestInput: unknown,
  cardDocuments: Record<string, unknown>,
  contractTestDocuments: Record<string, unknown> = {},
): ValidatedExecutablePluginPackage {
  const manifest = ExecutablePluginManifestSchema.parse(manifestInput);
  const functions = new Map(manifest.exports.functions.map((entry) => [entry.id, entry]));
  const cards: Record<string, ExecutablePluginCardDocument> = {};
  const contractTests: Record<string, ExecutablePluginContractTestDocument> = {};

  for (const cardExport of manifest.exports.cards) {
    if (!Object.prototype.hasOwnProperty.call(cardDocuments, cardExport.path)) {
      throw new Error(`Missing declared Card document: ${cardExport.path}`);
    }
    const card = ExecutablePluginCardDocumentSchema.parse(cardDocuments[cardExport.path]);
    if (card.kind !== cardExport.kind) {
      throw new Error(`Card ${cardExport.path} kind ${card.kind} does not match export kind ${cardExport.kind}.`);
    }
    if (card.spec.id !== cardExport.id) {
      throw new Error(`Card ${cardExport.path} id ${card.spec.id} does not match export id ${cardExport.id}.`);
    }

    if (card.kind === "action-card") {
      const implementation = functions.get(card.spec.functionExportId);
      if (!implementation || implementation.kind !== "action") {
        throw new Error(
          `Action Card ${card.spec.id} requires action export ${card.spec.functionExportId}.`,
        );
      }
    } else {
      for (const implementation of card.spec.providerImplementations ?? []) {
        if (!implementation.projectorExportId) continue;
        if (implementation.projectorPluginId && implementation.projectorPluginId !== manifest.id) continue;
        const projector = functions.get(implementation.projectorExportId);
        if (!projector || projector.kind !== "provider-projector") {
          throw new Error(
            `Model Card ${card.spec.id} requires provider projector export ${implementation.projectorExportId}.`,
          );
        }
      }
    }
    cards[cardExport.path] = card;
  }

  for (const path of manifest.contractTests) {
    if (!Object.prototype.hasOwnProperty.call(contractTestDocuments, path)) {
      throw new Error(`Missing declared contract test: ${path}`);
    }
    const contractTest = ExecutablePluginContractTestDocumentSchema.parse(
      contractTestDocuments[path],
    );
    const implementation = functions.get(contractTest.target.exportId);
    if (!implementation || implementation.kind !== contractTest.target.kind) {
      throw new Error(
        `Contract test ${contractTest.id} target ${contractTest.target.kind} `
          + `${contractTest.target.exportId} does not match function export.`,
      );
    }
    contractTests[path] = contractTest;
  }

  return { manifest, cards, contractTests };
}

export interface ExecutablePluginPermissionDiff {
  networkDomains: string[];
  secrets: string[];
  assetCapabilities: Array<"read" | "write">;
  hostTools: Array<"codex.imagegen">;
  filesystem: {
    read: string[];
    write: string[];
  };
  externalWrites: boolean;
  requiresApproval: boolean;
}

function addedValues<T>(before: readonly T[], after: readonly T[]): T[] {
  const existing = new Set(before);
  return [...new Set(after)].filter((value) => !existing.has(value));
}

/**
 * Returns only capability increases. Agents may freely remove permissions, but
 * the installer must ask the user before activating any non-empty diff.
 */
export function diffExecutablePluginPermissions(
  beforeInput: unknown,
  afterInput: unknown,
): ExecutablePluginPermissionDiff {
  const before = ExecutablePluginPermissionsSchema.parse(beforeInput);
  const after = ExecutablePluginPermissionsSchema.parse(afterInput);
  const diff: ExecutablePluginPermissionDiff = {
    networkDomains: addedValues(before.network.domains, after.network.domains),
    secrets: addedValues(before.secrets, after.secrets),
    assetCapabilities: addedValues(before.assets, after.assets),
    hostTools: addedValues(before.hostTools, after.hostTools),
    filesystem: {
      read: addedValues(before.filesystem.read, after.filesystem.read),
      write: addedValues(before.filesystem.write, after.filesystem.write),
    },
    externalWrites: !before.externalWrites && after.externalWrites,
    requiresApproval: false,
  };
  diff.requiresApproval = diff.networkDomains.length > 0
    || diff.secrets.length > 0
    || diff.assetCapabilities.length > 0
    || diff.hostTools.length > 0
    || diff.filesystem.read.length > 0
    || diff.filesystem.write.length > 0
    || diff.externalWrites;
  return diff;
}

export type ExecutablePluginRuntime = z.infer<typeof ExecutablePluginRuntimeSchema>;
export type ExecutableActionCard = z.infer<typeof ExecutableActionCardSchema>;
export type ExecutableActionPresentation = z.infer<typeof ExecutableActionPresentationSchema>;
export type ExecutablePluginCardDocument = z.infer<typeof ExecutablePluginCardDocumentSchema>;
export type ExecutablePluginCardRegistration = z.infer<
  typeof ExecutablePluginCardRegistrationSchema
>;
export type ExecutablePluginBinding = z.infer<typeof ExecutablePluginBindingSchema>;
export type ExecutablePluginAssetHandle = z.infer<typeof ExecutablePluginAssetHandleSchema>;
export type ExecutablePluginReference = z.infer<typeof ExecutablePluginReferenceSchema>;
export type ExecutablePluginInvocation = z.infer<typeof ExecutablePluginInvocationSchema>;
export type HostedExecutablePluginCapability = z.infer<typeof HostedExecutablePluginCapabilitySchema>;
export type ExecutablePluginOutput = z.infer<typeof ExecutablePluginOutputSchema>;
export type ExecutablePluginResult = z.infer<typeof ExecutablePluginResultSchema>;
export type ExecutablePluginBrokerOperation = z.infer<typeof ExecutablePluginBrokerOperationSchema>;
export type ExecutablePluginBrokerRequest = z.infer<typeof ExecutablePluginBrokerRequestSchema>;
export type ExecutablePluginBrokerResponse = z.infer<typeof ExecutablePluginBrokerResponseSchema>;
export type ExecutablePluginContractTestDocument = z.infer<
  typeof ExecutablePluginContractTestDocumentSchema
>;
export type ExecutablePluginCardExport = z.infer<typeof ExecutablePluginCardExportSchema>;
export type ExecutablePluginFunctionExport = z.infer<typeof ExecutablePluginFunctionExportSchema>;
export type ExecutablePluginPermissions = z.infer<typeof ExecutablePluginPermissionsSchema>;
export type ExecutablePluginManifest = z.infer<typeof ExecutablePluginManifestSchema>;
export type ExecutablePluginActivationReceipt = z.infer<
  typeof ExecutablePluginActivationReceiptSchema
>;
