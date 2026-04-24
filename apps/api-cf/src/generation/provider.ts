import type { GenerationContext } from "./context";

/**
 * Provider contract: take a context, do whatever durable steps are needed,
 * notify the room. Platform doesn't prescribe the step graph.
 */
export interface GenerationProvider {
  /** Human-readable tag used in logs. */
  readonly name: string;
  execute(ctx: GenerationContext): Promise<void>;
}
