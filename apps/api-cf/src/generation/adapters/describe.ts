/**
 * Description pipeline — currently disabled. Kept as an explicit no-op so
 * the dispatcher doesn't throw on describe tasks still in-flight.
 */
import type { GenerationAdapter } from "../adapter";

export const describeAdapter: GenerationAdapter = {
  name: "describe",
  async execute() {
    // Intentionally empty — description generation is temporarily disabled
    // (was a no-op in the legacy pipeline too). Reactivate by implementing
    // generateDescription() + notifyCompleted here.
  },
};
