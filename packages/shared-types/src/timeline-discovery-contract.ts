import { z } from "zod";

export const TIMELINE_DISCOVERY_VIEWS = ["authoring", "full"] as const;

export const TimelineDiscoveryViewSchema = z.enum(
  TIMELINE_DISCOVERY_VIEWS,
);

export type TimelineDiscoveryView = z.infer<
  typeof TimelineDiscoveryViewSchema
>;
