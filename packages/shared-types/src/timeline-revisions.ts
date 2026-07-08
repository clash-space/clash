import { z } from 'zod';

export const TimelineRevisionActorSchema = z.object({
  actorType: z.enum(['user', 'agent']),
  actorUserId: z.string(),
  actorAgentId: z.string().optional(),
});
export type TimelineRevisionActor = z.infer<typeof TimelineRevisionActorSchema>;

export const TimelineRevisionDependenciesSchema = z.object({
  sourceNodeIds: z.array(z.string()),
  assetIds: z.array(z.string()),
  componentIds: z.array(z.string()),
  textNodeIds: z.array(z.string()),
});
export type TimelineRevisionDependencies = z.infer<typeof TimelineRevisionDependenciesSchema>;

export const TimelineRevisionContentDescriptorSchema = z.object({
  kind: z.literal('timeline-revision-content'),
  timelineHash: z.string(),
  mediaType: z.literal('application/yaml'),
  url: z.string(),
  immutable: z.literal(true),
  storage: z.object({
    kind: z.literal('content-addressed-revision-blob'),
    registry: z.literal('timeline_revisions'),
    mediaAsset: z.literal(false),
    agentWritable: z.literal(false),
  }),
});
export type TimelineRevisionContentDescriptor = z.infer<typeof TimelineRevisionContentDescriptorSchema>;

export const TimelineAppliedRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('clash.timeline.revision'),
  timelineId: z.string(),
  revisionId: z.string(),
  parentRevisionId: z.string().optional(),
  projectId: z.string(),
  nodeId: z.string(),
  createdAt: z.string(),
  timelineHash: z.string(),
  hashAlgorithm: z.literal('sha256-64'),
  sourceFilePath: z.string(),
  sourceFileHash: z.string(),
  actor: TimelineRevisionActorSchema.optional(),
  loroFrontiers: z.array(z.unknown()).optional(),
  loroVersionVector: z.record(z.number()).optional(),
  dependencies: TimelineRevisionDependenciesSchema,
});
export type TimelineAppliedRevision = z.infer<typeof TimelineAppliedRevisionSchema>;

export const TimelineRevisionHistoryEntrySchema = TimelineAppliedRevisionSchema.extend({
  content: TimelineRevisionContentDescriptorSchema.optional(),
});
export type TimelineRevisionHistoryEntry = z.infer<typeof TimelineRevisionHistoryEntrySchema>;
