import { z } from "zod";

import { AssetKindSchema } from "./assets.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const idSchema = z.string().trim().min(1);

export const MediaAnalysisCategorySchema = z.enum([
  "description",
  "tags",
  "subjects",
  "actions-events",
  "scene-shot",
  "style",
  "ocr",
  "audio-semantics",
]);
export type MediaAnalysisCategory = z.infer<
  typeof MediaAnalysisCategorySchema
>;

const sourceSchema = z
  .object({
    projectAssetId: idSchema,
    resourceHash: sha256Schema,
    kind: AssetKindSchema.exclude(["model"]),
  })
  .strict();

function analysisBody<C extends MediaAnalysisCategory, R extends z.ZodType>(
  category: C,
  result: R,
) {
  return z
    .object({
      schemaVersion: z.literal(1),
      source: sourceSchema,
      modelId: idSchema,
      provider: idSchema,
      route: idSchema,
      underlyingModel: idSchema,
      category: z.literal(category),
      promptVersion: idSchema,
      generatorRevisionId: idSchema,
      actionRunId: idSchema,
      resultHash: sha256Schema,
      bodyHash: sha256Schema,
      result,
    })
    .strict();
}

const description = analysisBody(
  "description",
  z.object({ text: idSchema, language: idSchema.optional() }).strict(),
);
const tags = analysisBody(
  "tags",
  z.object({ tags: z.array(idSchema) }).strict(),
);
const subjects = analysisBody(
  "subjects",
  z
    .object({
      items: z.array(
        z
          .object({
            type: idSchema,
            name: idSchema,
            description: idSchema.optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);
const actionsEvents = analysisBody(
  "actions-events",
  z
    .object({
      items: z.array(
        z
          .object({
            label: idSchema,
            description: idSchema.optional(),
            startMs: z.number().int().nonnegative().optional(),
            endMs: z.number().int().positive().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);
const sceneShot = analysisBody(
  "scene-shot",
  z
    .object({
      scenes: z.array(
        z
          .object({
            description: idSchema,
            shotType: idSchema.optional(),
            startMs: z.number().int().nonnegative().optional(),
            endMs: z.number().int().positive().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);
const style = analysisBody(
  "style",
  z
    .object({
      summary: idSchema,
      mood: z.array(idSchema).optional(),
      composition: z.array(idSchema).optional(),
    })
    .strict(),
);
const ocr = analysisBody(
  "ocr",
  z
    .object({
      items: z.array(
        z
          .object({
            text: idSchema,
            language: idSchema.optional(),
            startMs: z.number().int().nonnegative().optional(),
            endMs: z.number().int().positive().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);
const audioSemantics = analysisBody(
  "audio-semantics",
  z
    .object({
      summary: idSchema,
      speechSummary: idSchema.optional(),
      music: z.array(idSchema).optional(),
      sounds: z.array(idSchema).optional(),
    })
    .strict(),
);

export const MediaAnalysisDocumentSchemas = {
  description,
  tags,
  subjects,
  "actions-events": actionsEvents,
  "scene-shot": sceneShot,
  style,
  ocr,
  "audio-semantics": audioSemantics,
} as const;

export const MEDIA_ANALYSIS_DOCUMENT_KIND_BY_CATEGORY = {
  description: "media.analysis.description",
  tags: "media.analysis.tags",
  subjects: "media.analysis.subjects",
  "actions-events": "media.analysis.actions-events",
  "scene-shot": "media.analysis.scene-shot",
  style: "media.analysis.style",
  ocr: "media.analysis.ocr",
  "audio-semantics": "media.analysis.audio-semantics",
} as const satisfies Record<MediaAnalysisCategory, string>;

export function mediaAnalysisDocumentSchema(
  kind: string,
  schemaVersion: number,
): z.ZodType {
  if (schemaVersion !== 1) {
    throw new Error(`Undeclared media analysis schema version: ${schemaVersion}.`);
  }
  const category = Object.entries(MEDIA_ANALYSIS_DOCUMENT_KIND_BY_CATEGORY).find(
    ([, declaredKind]) => declaredKind === kind,
  )?.[0] as MediaAnalysisCategory | undefined;
  if (!category) throw new Error(`Undeclared media analysis kind: ${kind}.`);
  return MediaAnalysisDocumentSchemas[category];
}
