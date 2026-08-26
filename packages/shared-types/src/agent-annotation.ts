/**
 * @file agent-annotation.ts
 * @description Transient, agent-addressable review annotations shared by creative surfaces and chat.
 * @module packages.shared-types.src.agent-annotation
 *
 * @responsibility
 * - Gives Canvas, Timeline, Director Stage, Asset, and Browser objects one composer attachment contract.
 * - Carries stable product identities rather than DOM coordinates or display-only selection state.
 * - Serializes annotations into an invisible prompt block understood by local and hosted agents.
 */

import { z } from "zod";

export const AgentAnnotationSurfaceSchema = z.enum([
  "canvas",
  "timeline",
  "director-stage",
  // Project assets annotated from the workspace sidebar / asset views.
  "asset",
  // A page or element selected in the desktop project's in-app browser.
  "browser",
]);

const AgentAnnotationBrowserRectSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const AgentAnnotationBrowserViewportSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  devicePixelRatio: z.number().finite().positive(),
});

export const AgentAnnotationBrowserContextSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("element"),
      url: z.string().url(),
      title: z.string().max(300),
      selector: z.string().trim().min(1).max(2_048),
      domPath: z.string().max(2_048).optional(),
      tagName: z.string().trim().min(1).max(120),
      id: z.string().max(200).optional(),
      classNames: z.array(z.string().max(120)).max(16).optional(),
      role: z.string().max(120).optional(),
      ariaLabel: z.string().max(300).optional(),
      text: z.string().max(1_200).optional(),
      attributes: z.record(z.string(), z.string()).optional(),
      outerHtml: z.string().max(4_000).optional(),
      computedStyles: z.record(z.string(), z.string()).optional(),
      rect: AgentAnnotationBrowserRectSchema,
      viewport: AgentAnnotationBrowserViewportSchema,
    }),
    z.object({
      kind: z.literal("region"),
      url: z.string().url(),
      title: z.string().max(300),
      rect: AgentAnnotationBrowserRectSchema,
      viewport: AgentAnnotationBrowserViewportSchema,
    }),
  ],
);

export const AgentAnnotationVisualRectSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
});

export const AgentAnnotationSelectionSchema = z.object({
  kind: z.literal("text-quote"),
  exact: z.string().trim().min(1).max(4_000),
  prefix: z.string().max(256).optional(),
  suffix: z.string().max(256).optional(),
  visualRects: z.array(AgentAnnotationVisualRectSchema).max(32).optional(),
});

export const AgentAnnotationTargetSchema = z.object({
  projectId: z.string().trim().min(1),
  surface: AgentAnnotationSurfaceSchema,
  surfaceId: z.string().trim().min(1),
  surfaceLabel: z.string().trim().min(1),
  revisionId: z.string().trim().min(1).optional(),
  objectId: z.string().trim().min(1),
  objectType: z.string().trim().min(1),
  objectLabel: z.string().trim().min(1),
  parentId: z.string().trim().min(1).optional(),
  objectPath: z.string().trim().min(1),
  capabilities: z.array(z.enum(["read", "modify"])).min(1),
  selection: AgentAnnotationSelectionSchema.optional(),
  /** Backchat-compatible page context for a browser element or region. */
  browser: AgentAnnotationBrowserContextSchema.optional(),
  /** Asset backing the annotated object, when it has one — lets chat surfaces show a media preview. */
  previewAssetId: z.string().trim().min(1).optional(),
});

export const AgentAnnotationDraftSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.literal("agent-annotation"),
  note: z.string().max(4_000),
  target: AgentAnnotationTargetSchema,
});

export const AgentAnnotationPromptPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("clash-agent-annotations"),
  annotations: z.array(AgentAnnotationDraftSchema).min(1),
});

export type AgentAnnotationSurface = z.infer<
  typeof AgentAnnotationSurfaceSchema
>;
export type AgentAnnotationBrowserContext = z.infer<
  typeof AgentAnnotationBrowserContextSchema
>;
export type AgentAnnotationSelection = z.infer<
  typeof AgentAnnotationSelectionSchema
>;
export type AgentAnnotationTarget = z.infer<typeof AgentAnnotationTargetSchema>;
export type AgentAnnotationVisualRect = z.infer<
  typeof AgentAnnotationVisualRectSchema
>;
export type AgentAnnotationDraft = z.infer<typeof AgentAnnotationDraftSchema>;
export type AgentAnnotationPromptPayload = z.infer<
  typeof AgentAnnotationPromptPayloadSchema
>;

export interface AgentAnnotationObjectRef {
  objectId: string;
  objectType: string;
  objectLabel: string;
  parentId?: string;
}

function escapeHtmlCommentPayload(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export function serializeAgentAnnotationPromptBlock(
  annotations: readonly AgentAnnotationDraft[],
): string | null {
  if (annotations.length === 0) return null;
  const payload = AgentAnnotationPromptPayloadSchema.parse({
    version: 1,
    kind: "clash-agent-annotations",
    annotations,
  });
  return `<!-- clash-agent-annotations ${escapeHtmlCommentPayload(JSON.stringify(payload))} -->`;
}
