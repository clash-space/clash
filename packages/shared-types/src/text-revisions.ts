import { z } from 'zod';

export const TextRevisionActorSchema = z.object({
  actorType: z.enum(['user', 'agent']),
  actorUserId: z.string(),
  actorAgentId: z.string().optional(),
});
export type TextRevisionActor = z.infer<typeof TextRevisionActorSchema>;

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
