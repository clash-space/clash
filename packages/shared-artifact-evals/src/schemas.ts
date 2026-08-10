import { z } from "zod";

import { PRODUCT_OPERATION_IDS } from "./product-operations";
import { ARTIFACT_KINDS } from "./types";

const SafeIdSchema = z.string().min(1).max(200);
const CapabilityIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ProductOperationIdSchema = z.enum(PRODUCT_OPERATION_IDS);
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeFixturePathSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
    "Fixture path must be a safe relative directory beneath suiteRoot",
  )
  .refine(
    (path) =>
      path.split("/").every((segment) => segment !== "." && segment !== ".."),
    "Fixture path must not contain dot segments",
  );

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);

export const ArtifactDescriptorSchema = z
  .object({
    id: SafeIdSchema,
    kind: ArtifactKindSchema,
    path: z.string().min(1),
  })
  .strict();

export const ArtifactSubmissionSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: SafeIdSchema,
    artifacts: z.array(ArtifactDescriptorSchema),
  })
  .strict()
  .superRefine((submission, context) => {
    const ids = new Set<string>();
    for (let index = 0; index < submission.artifacts.length; index += 1) {
      const id = submission.artifacts[index]?.id;
      if (id && ids.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "id"],
          message: `Duplicate artifact id: ${id}`,
        });
      }
      if (id) ids.add(id);
    }
  });

export const BenchmarkOutcomeSchema = z
  .object({
    objective: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    deliverables: z
      .array(
        z
          .object({
            artifactId: SafeIdSchema,
            kind: ArtifactKindSchema,
            description: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((outcome, context) => {
    const ids = new Set<string>();
    for (let index = 0; index < outcome.deliverables.length; index += 1) {
      const id = outcome.deliverables[index]?.artifactId;
      if (id && ids.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliverables", index, "artifactId"],
          message: `Duplicate outcome deliverable id: ${id}`,
        });
      }
      if (id) ids.add(id);
    }
  });

const RubricBaseSchema = z.object({
  id: SafeIdSchema,
  weight: z.number().positive(),
  required: z.boolean().optional(),
});

const ArtifactExistsRubricSchema = RubricBaseSchema.extend({
  type: z.literal("artifact-exists"),
  artifactId: SafeIdSchema,
  kind: ArtifactKindSchema.optional(),
  minBytes: NonNegativeIntegerSchema.optional(),
}).strict();

const ArtifactSetRubricSchema = RubricBaseSchema.extend({
  type: z.literal("artifact-set"),
  kind: ArtifactKindSchema.optional(),
  minCount: NonNegativeIntegerSchema,
  minBytes: NonNegativeIntegerSchema.optional(),
}).strict();

const DirectorStageRubricSchema = RubricBaseSchema.extend({
  type: z.literal("director-stage"),
  artifactId: SafeIdSchema,
  minObjects: NonNegativeIntegerSchema.optional(),
  minCameras: NonNegativeIntegerSchema.optional(),
  minCapturedShots: NonNegativeIntegerSchema.optional(),
  minSequenceShots: NonNegativeIntegerSchema.optional(),
  minAnimatedTracks: NonNegativeIntegerSchema.optional(),
  minActionClips: NonNegativeIntegerSchema.optional(),
  minMannequins: NonNegativeIntegerSchema.optional(),
  requireMannequin: z.boolean().optional(),
  requiredActions: z.array(z.string().min(1)).optional(),
}).strict();

const TimelineRubricSchema = RubricBaseSchema.extend({
  type: z.literal("timeline"),
  artifactId: SafeIdSchema,
  minTracks: NonNegativeIntegerSchema.optional(),
  minItems: NonNegativeIntegerSchema.optional(),
  minDurationInFrames: NonNegativeIntegerSchema.optional(),
  requiredItemTypes: z.array(z.string().min(1)).optional(),
}).strict();

const MgCharacterRubricSchema = RubricBaseSchema.extend({
  type: z.literal("mg-character"),
  artifactId: SafeIdSchema,
  profile: z.literal("remotion-tsx").optional(),
  minSourceBytes: NonNegativeIntegerSchema.optional(),
  requiredBodyParts: z.array(z.string().min(1)).optional(),
  requiredRemotionApis: z.array(z.string().min(1)).optional(),
}).strict();

const MediaRubricSchema = RubricBaseSchema.extend({
  type: z.literal("media"),
  artifactId: SafeIdSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  minDurationSeconds: z.number().nonnegative().optional(),
  maxDurationSeconds: z.number().nonnegative().optional(),
  requireVideo: z.boolean().optional(),
  requireAudio: z.boolean().optional(),
}).strict();

const VisualFramesRubricSchema = RubricBaseSchema.extend({
  type: z.literal("visual-frames"),
  artifactIds: z.array(SafeIdSchema).min(2),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  minDistinctPairs: z.number().int().positive(),
  minMeanAbsoluteDifference: z.number().min(0).max(1),
  foregroundCoverage: z
    .object({
      backgroundTolerance: z.number().nonnegative().max(255),
      minRatio: z.number().positive().max(1),
    })
    .strict()
    .optional(),
  safeArea: z
    .object({
      marginPercent: z.number().positive().max(0.25),
      backgroundTolerance: z.number().nonnegative().max(255),
      maxForegroundEdgeRatio: z.number().min(0).max(1),
    })
    .strict()
    .optional(),
}).strict();

const MixedLineageRubricSchema = RubricBaseSchema.extend({
  type: z.literal("mixed-lineage"),
  directorArtifactId: SafeIdSchema,
  timelineArtifactId: SafeIdSchema,
  componentArtifactId: SafeIdSchema,
}).strict();

export const ArtifactRubricSchema = z.discriminatedUnion("type", [
  ArtifactExistsRubricSchema,
  ArtifactSetRubricSchema,
  DirectorStageRubricSchema,
  TimelineRubricSchema,
  MgCharacterRubricSchema,
  MediaRubricSchema,
  VisualFramesRubricSchema,
  MixedLineageRubricSchema,
]);

const CapabilityPreflightSchema = z
  .object({
    status: z.enum(["ready", "blocked"]),
    checks: z
      .array(
        z
          .object({
            capability: CapabilityIdSchema,
            status: z.enum(["available", "missing"]),
            detail: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const ExecutionEvidenceSchema = z
  .object({
    traceRequired: z.literal(true),
    submissionRequired: z.literal(true),
  })
  .strict();

const ProductReadbackSchema = z
  .object({
    required: z.literal(true),
    mechanism: CapabilityIdSchema,
    artifactIds: z.array(SafeIdSchema).min(1),
    description: z.string().min(1),
  })
  .strict();

const BenchmarkExecutionSchema = z
  .object({
    profile: z.literal("clash-host"),
    requiredProductOperations: z
      .array(ProductOperationIdSchema)
      .min(1)
      .optional(),
    requiredMcpTools: z
      .array(z.string().regex(/^clash(?:_[a-z0-9_]+)?$/))
      .min(1)
      .optional(),
    requiredCliCommands: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]*(?: [a-z0-9][a-z0-9-]*)*$/))
      .optional(),
    requiredCapabilities: z.array(CapabilityIdSchema).min(1).optional(),
    preflight: CapabilityPreflightSchema.optional(),
    evidence: ExecutionEvidenceSchema.optional(),
    productReadback: ProductReadbackSchema.optional(),
  })
  .strict()
  .superRefine((execution, context) => {
    if (
      !execution.requiredProductOperations &&
      !execution.requiredMcpTools &&
      !execution.requiredCliCommands
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "At least one product operation or legacy transport-specific execution requirement must be declared",
      });
    }
    if (
      execution.requiredProductOperations &&
      new Set(execution.requiredProductOperations).size !==
        execution.requiredProductOperations.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredProductOperations"],
        message: "requiredProductOperations must be unique",
      });
    }
    const contractFields = [
      execution.requiredCapabilities,
      execution.preflight,
      execution.evidence,
      execution.productReadback,
    ];
    if (
      contractFields.some((field) => field !== undefined) &&
      contractFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "requiredCapabilities, preflight, evidence, and productReadback must be declared together",
      });
      return;
    }
    if (!execution.requiredCapabilities || !execution.preflight) return;

    const requiredCapabilities = new Set(execution.requiredCapabilities);
    if (requiredCapabilities.size !== execution.requiredCapabilities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredCapabilities"],
        message: "requiredCapabilities must be unique",
      });
    }
    const checkedCapabilities = new Set<string>();
    for (let index = 0; index < execution.preflight.checks.length; index += 1) {
      const capability = execution.preflight.checks[index]?.capability;
      if (!capability) continue;
      if (checkedCapabilities.has(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preflight", "checks", index, "capability"],
          message: `Duplicate preflight capability: ${capability}`,
        });
      }
      checkedCapabilities.add(capability);
      if (!requiredCapabilities.has(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preflight", "checks", index, "capability"],
          message: `Preflight capability is not required: ${capability}`,
        });
      }
    }
    for (const capability of requiredCapabilities) {
      if (!checkedCapabilities.has(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preflight", "checks"],
          message: `Missing preflight check for required capability: ${capability}`,
        });
      }
    }
    const hasMissingCapability = execution.preflight.checks.some(
      (check) => check.status === "missing",
    );
    if (execution.preflight.status === "ready" && hasMissingCapability) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "status"],
        message: "A ready preflight cannot contain missing capabilities",
      });
    }
    if (execution.preflight.status === "blocked" && !hasMissingCapability) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "status"],
        message:
          "A blocked preflight must identify at least one missing capability",
      });
    }
  });

export const ArtifactBenchmarkCaseSchema = z
  .object({
    id: SafeIdSchema,
    title: z.string().min(1),
    category: z.enum(["director", "timeline", "mg-character", "mixed"]),
    outcome: BenchmarkOutcomeSchema,
    prompt: z.string().optional(),
    passScore: z.number().min(0).max(100),
    timeoutMs: z.number().int().positive(),
    skills: z.array(z.string().min(1)),
    inputFixture: z
      .object({
        path: SafeFixturePathSchema,
        manifestSha256: Sha256Schema,
      })
      .strict()
      .optional(),
    execution: BenchmarkExecutionSchema.optional(),
    rubric: z.array(ArtifactRubricSchema).min(1),
  })
  .strict()
  .superRefine((benchmark, context) => {
    const ids = new Set<string>();
    for (let index = 0; index < benchmark.rubric.length; index += 1) {
      const id = benchmark.rubric[index]?.id;
      if (id && ids.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rubric", index, "id"],
          message: `Duplicate rubric id: ${id}`,
        });
      }
      if (id) ids.add(id);
    }
    for (let index = 0; index < benchmark.rubric.length; index += 1) {
      const rubric = benchmark.rubric[index];
      if (rubric?.type === "artifact-set") {
        const declaredCount = benchmark.outcome.deliverables.filter(
          (deliverable) => !rubric.kind || deliverable.kind === rubric.kind,
        ).length;
        if (declaredCount < rubric.minCount) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rubric", index, "minCount"],
            message: `Outcome declares ${declaredCount} ${rubric.kind ?? "matching"} deliverables but artifact set requires ${rubric.minCount}`,
          });
        }
      }
      if (
        rubric?.type === "media" &&
        rubric.minDurationSeconds !== undefined &&
        rubric.maxDurationSeconds !== undefined &&
        rubric.minDurationSeconds > rubric.maxDurationSeconds
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rubric", index, "minDurationSeconds"],
          message:
            "minDurationSeconds must be less than or equal to maxDurationSeconds",
        });
      }
      if (rubric?.type === "visual-frames") {
        const uniqueFrameIds = new Set(rubric.artifactIds);
        if (uniqueFrameIds.size !== rubric.artifactIds.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rubric", index, "artifactIds"],
            message: "visual-frames artifactIds must be unique",
          });
        }
        const pairCount =
          (rubric.artifactIds.length * (rubric.artifactIds.length - 1)) / 2;
        if (rubric.minDistinctPairs > pairCount) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rubric", index, "minDistinctPairs"],
            message: `minDistinctPairs cannot exceed ${pairCount}`,
          });
        }
        const imageDeliverables = new Set(
          benchmark.outcome.deliverables
            .filter((deliverable) => deliverable.kind === "image")
            .map((deliverable) => deliverable.artifactId),
        );
        for (const artifactId of rubric.artifactIds) {
          if (!imageDeliverables.has(artifactId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["rubric", index, "artifactIds"],
              message: `Visual frame '${artifactId}' must be declared as an image outcome deliverable`,
            });
          }
        }
      }
    }
    if (benchmark.execution?.productReadback) {
      const deliverableIds = new Set(
        benchmark.outcome.deliverables.map(
          (deliverable) => deliverable.artifactId,
        ),
      );
      const readbackIds = new Set<string>();
      for (
        let index = 0;
        index < benchmark.execution.productReadback.artifactIds.length;
        index += 1
      ) {
        const artifactId =
          benchmark.execution.productReadback.artifactIds[index];
        if (!artifactId) continue;
        if (readbackIds.has(artifactId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["execution", "productReadback", "artifactIds", index],
            message: `Duplicate product readback artifact id: ${artifactId}`,
          });
        }
        readbackIds.add(artifactId);
        if (!deliverableIds.has(artifactId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["execution", "productReadback", "artifactIds", index],
            message: `Product readback artifact is not an outcome deliverable: ${artifactId}`,
          });
        }
      }
    }
  });

export const ArtifactBenchmarkSuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: SafeIdSchema,
    title: z.string().min(1),
    cases: z.array(ArtifactBenchmarkCaseSchema).min(1),
  })
  .strict()
  .superRefine((suite, context) => {
    const ids = new Set<string>();
    for (let index = 0; index < suite.cases.length; index += 1) {
      const id = suite.cases[index]?.id;
      if (id && ids.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "id"],
          message: `Duplicate benchmark case id: ${id}`,
        });
      }
      if (id) ids.add(id);
    }
  });
