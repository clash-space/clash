import { z } from 'zod';

export const TextRevisionActorSchema = z.object({
  actorType: z.enum(['user', 'agent']),
  actorUserId: z.string(),
  actorAgentId: z.string().optional(),
});
export type TextRevisionActor = z.infer<typeof TextRevisionActorSchema>;

export const TextRevisionContentDescriptorSchema = z.object({
  kind: z.literal('text-revision-content'),
  contentHash: z.string(),
  mediaType: z.literal('text/markdown'),
  url: z.string(),
  immutable: z.literal(true),
  storage: z.object({
    kind: z.literal('content-addressed-revision-blob'),
    registry: z.literal('text_revisions'),
    mediaAsset: z.literal(false),
    agentWritable: z.literal(false),
  }),
});
export type TextRevisionContentDescriptor = z.infer<typeof TextRevisionContentDescriptorSchema>;

export const TextAppliedRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('clash.text.revision'),
  textId: z.string(),
  revisionId: z.string(),
  parentRevisionId: z.string().optional(),
  projectId: z.string(),
  nodeId: z.string(),
  createdAt: z.string(),
  contentHash: z.string(),
  hashAlgorithm: z.literal('sha256-64'),
  sourceFilePath: z.string(),
  sourceFileHash: z.string(),
  actor: TextRevisionActorSchema.optional(),
});
export type TextAppliedRevision = z.infer<typeof TextAppliedRevisionSchema>;

export const TextRevisionHistoryEntrySchema = TextAppliedRevisionSchema.extend({
  content: TextRevisionContentDescriptorSchema.optional(),
});
export type TextRevisionHistoryEntry = z.infer<typeof TextRevisionHistoryEntrySchema>;
