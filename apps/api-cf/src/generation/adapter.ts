import type { GenerationContext } from "./context";

/**
 * Adapter contract: take a context, do whatever durable steps are needed,
 * notify the room. Platform doesn't prescribe the step graph.
 *
 * One adapter translates one wire format. Which adapter runs is decided in registry.ts by the
 * route's `apiShape` or `upstreamId` — never by `providerId`, which says whose credential pays and
 * has no bearing on how the request is shaped.
 */
export interface GenerationAdapter {
  /**
   * Human-readable tag used in logs, surfaced as the `provider` field on generation events.
   *
   * Still spelled the way the telemetry consumers already read it, so these values do not track
   * the symbol names above.
   */
  readonly name: string;
  execute(ctx: GenerationContext): Promise<void>;
}
