import { z } from "zod";

import { AssetKindSchema } from "./assets";
import {
  ModelCardSchema,
  ModelConstraintRuleSchema,
  ModelInputRuleSchema,
  ModelParameterSchema,
  ModelProviderImplementationSchema,
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
    /**
     * Which interpreter the host launches.
     *
     * A closed enum rather than a command line: the host builds the argv, so it can
     * keep `--permission`, the network guard, and the Python filesystem allowlist
     * attached. A plugin that could name its own command could name `bash` and step
     * outside all of them.
     *
     * Optional only so the two manifests written before this field existed keep
     * loading; `resolvePluginLanguage` falls back to the entrypoint extension.
     * New drafts always declare it.
     */
    language: z.enum(["node", "python"]).optional(),
    entrypoint: PluginRelativePathSchema,
    args: z.array(z.string()).default([]),
    /**
     * Declares that the entrypoint is derived from source.
     *
     * Present means the host compiles `source` into `entrypoint` before validating,
     * contract-testing, or activating, so a stale bundle cannot be packaged. Absent
     * means the entrypoint is authored directly and the host never overwrites it --
     * which is the normal case for Python, and for a hand-written `.mjs`.
     */
    build: z.object({
      source: PluginRelativePathSchema,
    }).strict().optional(),
  }),
  z.object({
    kind: z.literal("hosted"),
    transport: z.literal("http"),
    endpoint: z.string().url(),
  }),
]);

/**
 * The interpreter for a local plugin.
 *
 * Declared `language` wins. Older manifests are inferred from the entrypoint
 * extension, which is what the loader used to do unconditionally -- the reason a
 * `.ts` entrypoint was impossible and why the extension whitelist doubled as a
 * language dispatcher.
 */
export function resolvePluginLanguage(
  runtime: { kind: string; language?: "node" | "python"; entrypoint?: string },
): "node" | "python" | undefined {
  if (runtime.kind !== "local") return undefined;
  if (runtime.language) return runtime.language;
  const entrypoint = runtime.entrypoint ?? "";
  return entrypoint.toLowerCase().endsWith(".py") ? "python" : "node";
}

export const ExecutablePluginCardExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.enum(["model-card", "action-card"]),
  path: PluginRelativePathSchema,
});

export const ExecutablePluginProviderExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.literal("provider"),
  path: PluginRelativePathSchema,
});

export const ExecutablePluginModelBindingExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.literal("model-provider-binding"),
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

export const ExecutablePluginProviderAuthSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("api-key"),
    credentialId: z.string().trim().min(1).default("apiKey"),
    label: z.string().trim().min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal("oauth"),
    id: z.string().trim().regex(PLUGIN_ID_PATTERN),
    flow: z.literal("browser"),
    authorizationUrl: z.string().url(),
    callback: z.object({
      type: z.literal("custom-scheme"),
      scheme: z.string().trim().regex(/^[a-z][a-z0-9+.-]*$/),
    }).strict(),
    accessTokenField: z.string().trim().min(1).default("accessToken"),
  }).strict(),
  /**
   * The stored secret is not the credential; a short-lived one is minted from it.
   *
   * Vertex is the case that forced this: a service account key holds an RSA private key, and the
   * credential the API accepts is a bearer token produced by signing a JWT with that key and
   * exchanging it (RFC 7523). The token lasts about an hour, the key until it is revoked.
   *
   * Kept apart from `api-key` because the two disagree about the one thing a host most wants to do
   * uniformly. For `api-key`, "send what is stored" is correct. Here it would put a private key on
   * the wire as a bearer token.
   *
   * Every field is a recipe. A manifest is authored by a plugin and readable by anyone who installs
   * it, so there is deliberately nowhere to write a key or a token: `.strict()` turns an attempt to
   * smuggle one into a validation error instead of a secret shipped in a package.
   */
  z.object({
    type: z.literal("derived-token"),
    id: z.string().trim().regex(PLUGIN_ID_PATTERN),
    label: z.string().trim().min(1).optional(),
    /**
     * Field holding the durable secret. Unlike the other kinds it does not default to `apiKey`:
     * what is stored here is a signing document, and that name would invite code to forward it.
     */
    credentialId: z.string().trim().min(1),
    derivation: z.object({
      /**
       * Closed for the same reason acquisition is: a plugin declares this but the host executes it,
       * holding the signing key while it does. An open field would let a plugin name a scheme
       * nobody implements, discovered when a generation fails rather than when it is installed.
       */
      kind: z.literal("jwt-bearer-assertion"),
      tokenUrl: z.string().url(),
      scope: z.string().trim().min(1),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("local-token-import"),
    id: z.string().trim().regex(PLUGIN_ID_PATTERN),
    label: z.string().trim().min(1).optional(),
    source: z.object({
      format: z.literal("electron-store-aes-256-gcm-v2"),
      appDataSubdirectory: PluginRelativePathSchema,
      configFile: PluginRelativePathSchema,
      keyFile: PluginRelativePathSchema,
      tokenPath: z.array(
        z.string().trim().regex(/^[A-Za-z0-9_-]+$/).refine(
          (segment) => !["__proto__", "constructor", "prototype"].includes(segment),
          "Token path contains a reserved property.",
        ),
      ).min(1),
    }).strict(),
  }).strict(),
]);

export const ExecutablePluginProviderDefinitionSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  upstreamId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  apiShape: z.string().trim().regex(PLUGIN_ID_PATTERN),
  executorExportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  auth: z.array(ExecutablePluginProviderAuthSchema).default([]),
  /**
   * Route values every binding of this provider inherits.
   *
   * A binding carries two facts: which catalogue model it routes, and the name that
   * model has upstream. The rest of the route -- provider id, upstream, api shape,
   * executor, credentials, priority -- belongs to the provider. Repeating it per
   * binding produced no information and one real hazard: a single mistyped copy
   * yields a route pointing at the wrong upstream while every sibling looks correct.
   */
  bindingDefaults: z.object({
    priority: z.number().nonnegative().optional(),
    weight: z.number().nonnegative().optional(),
    region: z.string().trim().min(1).optional(),
    accountId: z.string().trim().min(1).optional(),
  }).strict().optional(),
}).strict();

export const ExecutablePluginProviderDocumentSchema = z.object({
  apiVersion: z.literal("clash.provider/v1"),
  kind: z.literal("provider"),
  spec: ExecutablePluginProviderDefinitionSchema,
}).strict();

export const ExecutablePluginModelBindingSpecSchema = z.intersection(
  z.object({
    id: z.string().trim().regex(PLUGIN_ID_PATTERN),
    modelId: z.string().trim().min(1),
  }),
  ModelProviderImplementationSchema,
);

/**
 * The two facts a binding actually carries.
 *
 * Everything else about a route -- provider id, upstream, api shape, executor,
 * credentials, priority -- belongs to the provider document that owns the binding.
 */
export const ExecutablePluginModelBindingInputSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN).optional(),
  modelId: z.string().trim().min(1, "A binding must name the model it routes (modelId)."),
  upstreamModel: z.string().trim().min(1, "A binding must name its upstreamModel."),
  providerId: z.string().trim().min(1).optional(),
  upstreamId: z.string().trim().min(1).optional(),
  apiShape: z.string().trim().min(1).optional(),
  executorExportId: z.string().trim().min(1).optional(),
  requiredOAuth: z.array(z.string()).optional(),
  priority: z.number().optional(),
  weight: z.number().optional(),
  region: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional(),
}).passthrough();

/**
 * Fill a binding's route from the provider that owns it.
 *
 * The binding stays the two facts it carries; the provider supplies the rest, and an
 * explicit value on the binding still wins. Written out per binding, those shared
 * fields were 186 duplicated values across `hilo-hub-media`'s 31 files -- no added
 * information, and one mistyped copy would route a model at the wrong upstream while
 * every sibling looked correct.
 *
 * `requiredOAuth` is derived from the provider's declared auth rather than repeated,
 * so the credential a route needs cannot drift from the credential the provider
 * knows how to obtain.
 */
export function resolveModelBindingFromProvider(
  binding: z.input<typeof ExecutablePluginModelBindingInputSchema>,
  provider: z.infer<typeof ExecutablePluginProviderDefinitionSchema>,
): Record<string, unknown> {
  const parsed = ExecutablePluginModelBindingInputSchema.parse(binding);
  const defaults = provider.bindingDefaults ?? {};
  // One credential can be obtained several ways -- a login page and an import of another
  // app's token are two routes to the same `hilo-hub` credential -- so the ids are
  // de-duplicated. An `api-key` entry carries no id: it is the credential itself, not a
  // named acquisition a route has to wait for.
  const oauthIds = [
    ...new Set(
      provider.auth
        .filter((entry): entry is Extract<typeof entry, { id: string }> => "id" in entry)
        .map((entry) => entry.id),
    ),
  ];

  const resolved: Record<string, unknown> = {
    ...parsed,
    id: parsed.id ?? `${provider.id}-${parsed.modelId}`,
    providerId: parsed.providerId ?? provider.id,
    upstreamId: parsed.upstreamId ?? provider.upstreamId,
    apiShape: parsed.apiShape ?? provider.apiShape,
    executorExportId: parsed.executorExportId ?? provider.executorExportId,
  };

  const inheritedOAuth = parsed.requiredOAuth ?? (oauthIds.length > 0 ? oauthIds : undefined);
  if (inheritedOAuth) resolved.requiredOAuth = inheritedOAuth;
  else delete resolved.requiredOAuth;

  for (const key of ["priority", "weight", "region", "accountId"] as const) {
    const value = parsed[key] ?? defaults[key];
    if (value === undefined) delete resolved[key];
    else resolved[key] = value;
  }

  return resolved;
}

export const ExecutablePluginModelBindingDocumentSchema = z.object({
  apiVersion: z.literal("clash.binding/v1"),
  kind: z.literal("model-provider-binding"),
  spec: ExecutablePluginModelBindingSpecSchema,
}).strict();

/**
 * The operations an entry point answers.
 *
 * Declared rather than discovered. The alternative is to find out by sending a poll and seeing
 * whether the plugin understands it -- after the work was submitted and billed, which is the worst
 * moment to learn that nobody can collect the result.
 *
 * It also governs what the host offers. A callback address goes only to an entry that says it
 * handles callbacks; handing one to a plugin that ignores it leaves a provider calling an address
 * nobody translates, while the node waits for an answer that already arrived.
 */
export const PLUGIN_ENTRY_OPERATIONS = ["submit", "poll", "callback"] as const;

export const PluginEntryOperationSchema = z.enum(PLUGIN_ENTRY_OPERATIONS);
export type PluginEntryOperation = z.infer<typeof PluginEntryOperationSchema>;

export const ExecutablePluginFunctionExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.enum(["action", "provider-projector", "provider-executor"]),
  handler: z.string().trim().min(1),
  /** Defaults to submit-only: the simplest plugin declares nothing and gets the simplest contract. */
  operations: z.array(PluginEntryOperationSchema).nonempty().default(["submit"]),
}).superRefine((entry, ctx) => {
  if (!entry.operations.includes("submit")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operations"],
      message: "An entry must handle submit; nothing can be polled that was never started.",
    });
  }
  if (entry.operations.includes("callback") && !entry.operations.includes("poll")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operations"],
      message:
        "An entry handling callbacks must also handle poll. A callback that never arrives is an "
        + "ordinary event -- providers drop them and networks partition -- and without a poll to "
        + "fall back on the work is lost.",
    });
  }
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

const ExecutablePluginArtifactRegistrationBaseSchema = z.object({
  pluginId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  version: z.string().trim().regex(SEMVER_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN),
  runtime: ExecutablePluginRuntimeSchema,
  permissions: ExecutablePluginPermissionsSchema,
});

export const ExecutablePluginProviderRegistrationSchema =
  ExecutablePluginArtifactRegistrationBaseSchema.extend({
    document: ExecutablePluginProviderDocumentSchema,
  }).strict();

export const ExecutablePluginModelBindingRegistrationSchema =
  ExecutablePluginArtifactRegistrationBaseSchema.extend({
    document: ExecutablePluginModelBindingDocumentSchema,
  }).strict();

/**
 * Interpret active plugin model Cards as the effective source of truth. Cards
 * replace a built-in with the same id, while new ids are appended. Projector
 * exports that omit an explicit owner are bound to the package provenance.
 */
export function composeExecutablePluginModelCards(
  baseModelsInput: readonly ModelCard[],
  registrationsInput: readonly ExecutablePluginCardRegistration[],
  modelBindingRegistrationsInput: readonly ExecutablePluginModelBindingRegistration[] = [],
): ModelCard[] {
  const baseModels = z.array(ModelCardSchema).parse(baseModelsInput);
  const registrations = z.array(ExecutablePluginCardRegistrationSchema).parse(registrationsInput);
  const modelBindingRegistrations = z.array(ExecutablePluginModelBindingRegistrationSchema)
    .parse(modelBindingRegistrationsInput);
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
      providerImplementations: registration.document.spec.providerImplementations?.map((implementation) => ({
        ...implementation,
        ...(implementation.projectorExportId && !implementation.projectorPluginId
          ? { projectorPluginId: registration.pluginId }
          : {}),
        ...(implementation.executorExportId && !implementation.executorPluginId
          ? { executorPluginId: registration.pluginId }
          : {}),
      })),
    });
    pluginModels.set(id, { pluginId: registration.pluginId, model });
  }

  const baseIds = new Set(baseModels.map((model) => model.id));
  const composed = [
    ...baseModels.map((model) => pluginModels.get(model.id)?.model ?? model),
    ...[...pluginModels.values()]
      .map((entry) => entry.model)
      .filter((model) => !baseIds.has(model.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
  ];

  const bindingsByModel = new Map<string, Array<{
    pluginId: string;
    implementation: z.infer<typeof ModelProviderImplementationSchema>;
  }>>();
  for (const registration of modelBindingRegistrations) {
    const { id: _id, modelId, ...implementationInput } = registration.document.spec;
    const implementation = ModelProviderImplementationSchema.parse({
      ...implementationInput,
      ...(implementationInput.projectorExportId && !implementationInput.projectorPluginId
        ? { projectorPluginId: registration.pluginId }
        : {}),
      ...(implementationInput.executorExportId && !implementationInput.executorPluginId
        ? { executorPluginId: registration.pluginId }
        : {}),
    });
    const entries = bindingsByModel.get(modelId) ?? [];
    const routeKey = [implementation.providerId, implementation.accountId ?? "", implementation.region ?? ""]
      .join(":");
    const duplicate = entries.find((entry) => [
      entry.implementation.providerId,
      entry.implementation.accountId ?? "",
      entry.implementation.region ?? "",
    ].join(":") === routeKey);
    if (duplicate) {
      throw new Error(
        `Plugins ${duplicate.pluginId} and ${registration.pluginId} both bind model Card ${modelId} to ${routeKey}.`,
      );
    }
    entries.push({ pluginId: registration.pluginId, implementation });
    bindingsByModel.set(modelId, entries);
  }

  return composed.map((model) => {
    const external = bindingsByModel.get(model.id) ?? [];
    if (external.length === 0) return model;
    const implementations = [...(model.providerImplementations ?? [])];
    for (const entry of external) {
      const routeKey = [entry.implementation.providerId, entry.implementation.accountId ?? "", entry.implementation.region ?? ""]
        .join(":");
      const duplicate = implementations.some((implementation) => [
        implementation.providerId,
        implementation.accountId ?? "",
        implementation.region ?? "",
      ].join(":") === routeKey);
      if (duplicate) {
        throw new Error(`Model Card ${model.id} already declares provider binding ${routeKey}.`);
      }
      implementations.push(entry.implementation);
    }
    const availableProviders = [...new Set([
      ...(model.availableProviders ?? []),
      ...implementations.map((implementation) => implementation.providerId),
    ])];
    return ModelCardSchema.parse({
      ...model,
      availableProviders,
      defaultProvider: model.defaultProvider ?? availableProviders[0],
      providerImplementations: implementations,
    });
  });
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

const ExecutablePluginAssetHandleObjectSchema = z.object({
  assetId: z.string().trim().min(1),
  uri: z.string().regex(/^clash-asset:\/\/.+/),
  kind: AssetKindSchema,
  mediaType: z.string().trim().min(1).optional(),
  /**
   * Where the bytes are, when the host has not stored them yet.
   *
   * A generation plugin ends up with a link its upstream published, and returning it through the
   * asset channel keeps the media type a declared field instead of a hand-rolled one. Absent for a
   * handle that names an asset the host already holds.
   */
  url: z.string().url().optional(),
  /** Who can fetch `url`. The host cannot retrieve an address only the plugin can see. */
  reach: z.enum(["public", "private"]).optional(),
  /**
   * Which credential opens `url`, when an anonymous request will not.
   *
   * Some providers leave a finished generation behind their own auth: Gemini's Files API wants the
   * key that made the request, Vertex expects a bearer token. `reach` cannot express this -- it says
   * whether an address may be handed to a third party, and these may be. What they cannot be is
   * opened by a stranger. Fetching one bare returns 403 after the work succeeded and was billed.
   *
   * Absent means anonymous, which is what a published CDN link needs. The plugin still never holds
   * the token: it names the credential and the broker injects it, exactly as on the way out.
   */
  credential: z.literal("provider").optional(),
}).strict();

/**
 * Same fields, with the url/reach pairing enforced. `extend` needs the plain object, so the
 * refinement lives on this export rather than on the shape itself.
 */
export const ExecutablePluginAssetHandleSchema = ExecutablePluginAssetHandleObjectSchema
  .superRefine((handle, ctx) => {
  if (handle.credential && !handle.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["credential"],
      message: "A credential opens an address. Bytes have none.",
    });
  }
  if (handle.url && !handle.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An asset handle with a url must state its reach.",
    });
  }
  if (!handle.url && handle.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An asset handle's reach applies to a url.",
    });
  }
});

/**
 * What the broker returns when a plugin resolves a `clash-asset://` handle.
 *
 * Either shape is valid, and exactly one must be present. The local broker reads a file and
 * returns `dataBase64`; a hosted broker whose assets live in object storage can return a
 * short-lived `url` and move no bytes at all. That is the seam the cloud path needs: a Card
 * may accept a 30 MB reference and several of them, and copying those through an IPC frame
 * does not scale.
 *
 * A plugin branches on which field it received -- a capability question -- and never on
 * whether it is running locally or hosted, which would fork the workflow the local-first
 * model keeps single.
 */
export const ExecutablePluginAssetReadResultSchema = z.object({
  handle: z.string().trim().min(1),
  kind: AssetKindSchema,
  mediaType: z.string().trim().min(1).optional(),
  byteLength: z.number().int().nonnegative(),
  /** Fetchable by the plugin. A `clash-asset://` handle is the request, not an answer. */
  url: z.string().url().refine(value => !value.startsWith("clash-asset://"), {
    message: "asset.read url must be fetchable, not another asset handle.",
  }).optional(),
  /**
   * Who can fetch `url`.
   *
   * `public` means the provider can retrieve it directly, so it may be forwarded upstream.
   * `private` means only this plugin process can -- a local asset served on loopback, say --
   * and forwarding it would hand the provider an address that answers for somebody else.
   * Both are `https?://` strings, so nothing downstream can tell them apart by inspection.
   */
  reach: z.enum(["public", "private"]).optional(),
  dataBase64: z.string().optional(),
}).strict().superRefine((result, ctx) => {
  if (Boolean(result.url) === Boolean(result.dataBase64)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asset.read returns exactly one of url or dataBase64.",
    });
  }
  if (result.url && !result.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asset.read url requires a reach of public or private.",
    });
  }
  if (result.dataBase64 && result.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asset.read reach applies to a url; bytes have none.",
    });
  }
});

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
    kind: z.enum(["action", "provider-projector", "provider-executor"]),
  }),
  input: z.object({
    values: z.record(ExecutablePluginJsonValueSchema).default({}),
    references: z.array(ExecutablePluginReferenceSchema).default([]),
  }).strict(),
  actor: z.object({
    kind: z.enum(["user", "agent", "system"]),
    id: z.string().trim().min(1).optional(),
  }).strict(),
  /**
   * Which translation the host wants: start the work, or report on work already started.
   *
   * A plugin at this level only converts shapes. `submit` turns Clash's request into the provider's
   * request and reads back an id; `poll` turns that id into the provider's status request and reads
   * back a verdict. Neither waits. The loop, the interval, the retry budget, and the durability are
   * the host's, because none of them differ by provider -- and because only the host survives its
   * own restart.
   *
   * Stated as a field rather than inferred from an absent one: a plugin that mistakes a status
   * query for a submission bills the user twice.
   */
  operation: z.enum(["submit", "poll", "callback"]).default("submit"),
  /**
   * Where the provider should report completion, issued by the host at submit time.
   *
   * The plugin cannot supply this. It has no address: a `local` plugin listens on nothing, and a
   * short-lived translator has nowhere to keep a listener even if it did. The same reasoning already
   * governs upload targets -- the host issues the address, so reachability holds by construction
   * rather than by a plugin's claim about itself.
   *
   * Absent when the host cannot receive callbacks, which is the local single-user case today. A
   * plugin that sees no callback URL submits for polling instead; both paths end in `accepted`.
   */
  callbackUrl: z.string().url().optional(),
  /** The opaque state the plugin returned when it accepted the work. Required by `poll`. */
  pollState: ExecutablePluginJsonValueSchema.optional(),
  /**
   * The provider's own callback body, verbatim, for the plugin to translate.
   *
   * The host receives this on the address it issued and cannot read it: the payload is in the
   * provider's shape, which is exactly the thing this plugin exists to translate. So the host routes
   * it back rather than parsing it, and the plugin answers with the same `completed` or `failed` it
   * would have returned from a poll.
   */
  callbackPayload: ExecutablePluginJsonValueSchema.optional(),
  /**
   * The callback request's headers, so the plugin can decide whether to believe it.
   *
   * Providers sign callbacks, and they sign them in headers -- an HMAC over the raw body, a
   * timestamp, a key id. Only the plugin knows which scheme this provider uses, so only the plugin
   * can verify, and it cannot verify from a body alone. Withholding these would leave one defence
   * standing: that the address is hard to guess. An address travels through the provider's logs,
   * any proxy in between, and a referrer header, so it is a weak thing to rest on by itself.
   *
   * A plugin that cannot verify a callback returns `failed`, and the work stays pending until a poll
   * settles it. Refusing to believe an unverified message is not a failure to make progress -- the
   * poll path is still there, and it authenticates in the other direction.
   */
  callbackHeaders: z.record(z.string()).optional(),
}).strict().superRefine((invocation, ctx) => {
  if (invocation.operation === "poll" && invocation.pollState === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pollState"],
      message: "A poll must carry the state the plugin returned when it accepted the work.",
    });
  }
  if (invocation.operation === "submit" && invocation.pollState !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pollState"],
      message: "A submit starts new work and cannot carry poll state.",
    });
  }
  if (invocation.operation === "callback" && invocation.callbackPayload === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackPayload"],
      message: "A callback must carry the body the provider sent.",
    });
  }
  if (invocation.operation !== "callback" && invocation.callbackHeaders !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackHeaders"],
      message: "callbackHeaders belongs to a callback.",
    });
  }
  if (invocation.operation !== "callback" && invocation.callbackPayload !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackPayload"],
      message: "callbackPayload belongs to a callback.",
    });
  }
  if (invocation.operation !== "submit" && invocation.callbackUrl !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackUrl"],
      message: "A callback address is issued when the work is submitted, not afterwards.",
    });
  }
});

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
      kind: z.enum(["action", "provider-projector", "provider-executor"]),
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
  /**
   * The provider took the work and has not finished it.
   *
   * A blocking call keeps the upstream's task id in its own stack, so a host that stops mid-flight
   * cannot find the work again -- the node stays pending forever and the generation is already
   * billed. Naming the task hands the host something durable to resume from, and moves the retry
   * loop out of every plugin that currently rewrites it.
   *
   * How the host learns the answer is deliberately unspecified here. Polling and a cloud callback
   * differ only in what wakes the host; the plugin's shape is the same either way.
   */
  z.object({
    protocol: z.literal("clash.plugin.result/v1"),
    invocationId: z.string().trim().min(1),
    status: z.literal("accepted"),
    /**
     * Whatever this plugin needs to ask about the work again, stored verbatim and handed back.
     *
     * Not an id, because plenty of providers have no id: one returns a status URL, another needs a
     * region alongside a job name, a third hands back a cursor. Any of those fits here, and the host
     * reads none of it -- it persists the value and returns it on the next poll. Naming a field
     * `taskId` would have forced every provider without one to fake it.
     */
    pollState: ExecutablePluginJsonValueSchema,
    /** How long to wait before asking again, when the provider says. */
    retryAfterMs: z.number().int().positive().optional(),
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
    /**
     * Where the result already lives, for the host to fetch once.
     *
     * A generation plugin normally ends up with a link the upstream published, and passing that
     * through means the bytes cross the wire exactly once and never touch the plugin. Without this
     * field the only ways to return such a result were to download it and re-encode it inline, or
     * to smuggle the link through a free-form `kind: "value"` output -- which is what
     * `hilo-hub-media` does, and why its media type is hardcoded per model kind instead of read
     * from the response.
     */
    url: z.string().url().optional(),
    /** Who can fetch `url`. A host cannot retrieve an address only the plugin can see. */
    reach: z.enum(["public", "private"]).optional(),
    dataBase64: z.string().max(128 * 1024 * 1024).regex(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      "Plugin asset data must be canonical base64.",
    ).optional(),
  }).strict().superRefine((operation, ctx) => {
    const sources = [operation.sourceHandle, operation.url, operation.dataBase64]
      .filter((source) => source !== undefined).length;
    if (sources !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "asset.write requires exactly one of sourceHandle, url, or dataBase64.",
      });
    }
    if (operation.url && !operation.reach) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "asset.write url requires a reach of public or private.",
      });
    }
    if (!operation.url && operation.reach) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "asset.write reach applies to a url.",
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
    references: z.array(ExecutablePluginAssetHandleObjectSchema.extend({
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
    kind: z.enum(["action", "provider-projector", "provider-executor"]),
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

/**
 * What follows from a plugin's run mode.
 *
 * `runtime.kind` is mandatory and discriminates the manifest, so it is the one place run mode is
 * stated. Anything that differs between a plugin the host spawns here and one it calls over HTTP
 * belongs in this profile rather than in a second manifest field, which could only repeat this or
 * contradict it -- the same duplication as a binding restating its provider's route.
 *
 * Today the difference that has a consumer is reach: a `local` plugin shares the host's network
 * namespace, so the host's own asset endpoint is fetchable, while for a `hosted` plugin that same
 * address answers for something unrelated. Both are `https?://` strings, so nothing downstream can
 * tell them apart by inspection, and the host has to decide. Bytes need no entry here because both
 * modes can receive them; a hosted plugin merely pays to.
 *
 * The remaining `runtime.kind` branches in the codebase are structural, not capability-based --
 * whether to read `entrypoint` or `endpoint` -- and routing those through a profile would add a
 * layer without removing a decision.
 */
/**
 * Where a plugin should PUT a result it holds as bytes, or undefined when no target exists.
 *
 * The host issues the address, which is what makes one plugin code path serve both run modes: a
 * `local` plugin gets the host's own endpoint because it runs here, a `hosted` plugin gets a
 * pre-signed public one. The plugin needs no idea which world it is in.
 *
 * This is the inverse of returning a URL, and both are needed. Returning a URL is cheapest when
 * the upstream already published the result, but it requires the host to reach an address the
 * plugin chose. An upload target is reachable by construction, at the cost of one more transfer.
 *
 * A hosted plugin gets nothing when no public target exists: handing it the loopback address would
 * point it at whatever answers on its own network.
 */
export function uploadTargetForRuntime(
  kind: "local" | "hosted",
  targets: { localBaseUrl?: string; publicUploadUrl?: string },
): string | undefined {
  if (targets.publicUploadUrl) return targets.publicUploadUrl;
  if (kind === "local" && targets.localBaseUrl) {
    return `${targets.localBaseUrl.replace(/\/+$/, "")}/plugin-uploads`;
  }
  return undefined;
}

export function pluginRuntimeProfile(kind: "local" | "hosted"): {
  assetReach: readonly ("public" | "private")[];
} {
  return kind === "local"
    ? { assetReach: ["public", "private"] }
    : { assetReach: ["public"] };
}

/** Which URL reaches a plugin running in this mode. See {@link pluginRuntimeProfile}. */
export function assetReachForRuntime(kind: "local" | "hosted"): readonly ("public" | "private")[] {
  return pluginRuntimeProfile(kind).assetReach;
}

export const ExecutablePluginManifestSchema = z.object({
  apiVersion: z.literal("clash.plugin/v1"),
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  version: z.string().trim().regex(SEMVER_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  runtime: ExecutablePluginRuntimeSchema,
  exports: z.object({
    cards: z.array(ExecutablePluginCardExportSchema).default([]),
    providers: z.array(ExecutablePluginProviderExportSchema).default([]),
    modelBindings: z.array(ExecutablePluginModelBindingExportSchema).default([]),
    functions: z.array(ExecutablePluginFunctionExportSchema).default([]),
  }),
  permissions: ExecutablePluginPermissionsSchema,
  contractTests: z.array(PluginRelativePathSchema).default([]),
  author: z.string().trim().min(1).optional(),
  repository: z.string().trim().min(1).optional(),
}).superRefine((manifest, ctx) => {
  for (const [key, values] of [
    ["cards", manifest.exports.cards],
    ["providers", manifest.exports.providers],
    ["modelBindings", manifest.exports.modelBindings],
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
  const artifactPaths = new Set(cardPaths);
  for (const artifact of [
    ...manifest.exports.providers,
    ...manifest.exports.modelBindings,
  ]) {
    if (artifactPaths.has(artifact.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exports"],
        message: "Plugin declarative artifact paths must be unique.",
      });
    }
    artifactPaths.add(artifact.path);
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
  providers: Record<string, ExecutablePluginProviderDocument>;
  modelBindings: Record<string, ExecutablePluginModelBindingDocument>;
  contractTests: Record<string, ExecutablePluginContractTestDocument>;
}

/** Strictly validates one unpacked plugin before it can become active. */
/**
 * Apply provider inheritance to one raw binding document.
 *
 * The owning provider is the one the binding names, or -- when it names none -- the sole
 * provider this package exports. A package that exports several providers has to say
 * which one a binding belongs to, since guessing would silently route a model at whichever
 * provider happened to be declared first.
 */
function inheritBindingRoute(
  input: unknown,
  providers: Record<string, z.infer<typeof ExecutablePluginProviderDocumentSchema>>,
  bindingExportId: string,
): unknown {
  if (typeof input !== "object" || input === null) return input;
  const document = input as { spec?: unknown };
  if (typeof document.spec !== "object" || document.spec === null) return input;
  const spec = document.spec as Record<string, unknown>;

  const declared = typeof spec.providerId === "string" ? spec.providerId : undefined;
  const definitions = Object.values(providers).map((provider) => provider.spec);
  const owner = declared
    ? definitions.find((definition) => definition.id === declared)
    : definitions.length === 1
      ? definitions[0]
      : undefined;

  if (!owner) {
    // A binding naming a provider from another plugin is left exactly as written; only a
    // provider in this package can supply defaults.
    if (declared || definitions.length === 0) return input;
    throw new Error(
      `Model Provider binding ${bindingExportId} must name its providerId: `
        + `this package exports ${definitions.length} providers.`,
    );
  }

  return { ...document, spec: resolveModelBindingFromProvider(spec as never, owner) };
}

export function validateExecutablePluginPackage(
  manifestInput: unknown,
  cardDocuments: Record<string, unknown>,
  contractTestDocuments: Record<string, unknown> = {},
  artifacts: {
    providers?: Record<string, unknown>;
    modelBindings?: Record<string, unknown>;
  } = {},
): ValidatedExecutablePluginPackage {
  const manifest = ExecutablePluginManifestSchema.parse(manifestInput);
  const functions = new Map(manifest.exports.functions.map((entry) => [entry.id, entry]));
  const cards: Record<string, ExecutablePluginCardDocument> = {};
  const providers: Record<string, ExecutablePluginProviderDocument> = {};
  const modelBindings: Record<string, ExecutablePluginModelBindingDocument> = {};
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

  for (const providerExport of manifest.exports.providers) {
    const input = artifacts.providers?.[providerExport.path];
    if (input === undefined) {
      throw new Error(`Missing declared Provider document: ${providerExport.path}`);
    }
    const provider = ExecutablePluginProviderDocumentSchema.parse(input);
    if (provider.spec.id !== providerExport.id) {
      throw new Error(
        `Provider ${providerExport.path} id ${provider.spec.id} does not match export id ${providerExport.id}.`,
      );
    }
    const executor = functions.get(provider.spec.executorExportId);
    if (!executor || executor.kind !== "provider-executor") {
      throw new Error(
        `Provider ${provider.spec.id} requires provider executor export ${provider.spec.executorExportId}.`,
      );
    }
    providers[providerExport.path] = provider;
  }

  for (const bindingExport of manifest.exports.modelBindings) {
    const input = artifacts.modelBindings?.[bindingExport.path];
    if (input === undefined) {
      throw new Error(`Missing declared model Provider binding: ${bindingExport.path}`);
    }
    // Fill the route from the provider before validating, so a binding may carry only the
    // two facts it owns: which catalogue model it routes and that model's upstream name.
    // Written out per binding, the shared route fields were 186 duplicated values across
    // one plugin's 31 files -- no added information, and one mistyped copy would point a
    // model at the wrong upstream while every sibling looked correct.
    const bindingInput = inheritBindingRoute(input, providers, bindingExport.id);
    const binding = ExecutablePluginModelBindingDocumentSchema.parse(bindingInput);
    if (binding.spec.id !== bindingExport.id) {
      throw new Error(
        `Model Provider binding ${bindingExport.path} id ${binding.spec.id} `
          + `does not match export id ${bindingExport.id}.`,
      );
    }
    for (const [exportId, kind] of [
      [binding.spec.projectorExportId, "provider-projector"],
      [binding.spec.executorExportId, "provider-executor"],
    ] as const) {
      if (!exportId) continue;
      const ownerId = kind === "provider-projector"
        ? binding.spec.projectorPluginId
        : binding.spec.executorPluginId;
      if (ownerId && ownerId !== manifest.id) continue;
      const implementation = functions.get(exportId);
      if (!implementation || implementation.kind !== kind) {
        throw new Error(
          `Model Provider binding ${binding.spec.id} requires ${kind} export ${exportId}.`,
        );
      }
    }
    modelBindings[bindingExport.path] = binding;
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

  return { manifest, cards, providers, modelBindings, contractTests };
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
export type ExecutablePluginProviderAuth = z.infer<typeof ExecutablePluginProviderAuthSchema>;
export type ExecutablePluginProviderDefinition = z.infer<typeof ExecutablePluginProviderDefinitionSchema>;
export type ExecutablePluginProviderDocument = z.infer<typeof ExecutablePluginProviderDocumentSchema>;
export type ExecutablePluginProviderRegistration = z.infer<
  typeof ExecutablePluginProviderRegistrationSchema
>;
export type ExecutablePluginModelBindingSpec = z.infer<typeof ExecutablePluginModelBindingSpecSchema>;
export type ExecutablePluginModelBindingDocument = z.infer<
  typeof ExecutablePluginModelBindingDocumentSchema
>;
export type ExecutablePluginModelBindingRegistration = z.infer<
  typeof ExecutablePluginModelBindingRegistrationSchema
>;
export type ExecutablePluginBinding = z.infer<typeof ExecutablePluginBindingSchema>;
export type ExecutablePluginAssetHandle = z.infer<typeof ExecutablePluginAssetHandleSchema>;
export type ExecutablePluginAssetReadResult = z.infer<typeof ExecutablePluginAssetReadResultSchema>;
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
export type ExecutablePluginProviderExport = z.infer<typeof ExecutablePluginProviderExportSchema>;
export type ExecutablePluginModelBindingExport = z.infer<typeof ExecutablePluginModelBindingExportSchema>;
export type ExecutablePluginFunctionExport = z.infer<typeof ExecutablePluginFunctionExportSchema>;
export type ExecutablePluginPermissions = z.infer<typeof ExecutablePluginPermissionsSchema>;
export type ExecutablePluginManifest = z.infer<typeof ExecutablePluginManifestSchema>;
export type ExecutablePluginActivationReceipt = z.infer<
  typeof ExecutablePluginActivationReceiptSchema
>;
