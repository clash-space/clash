import { z } from 'zod';

/**
 * The states a generation can be in, named once by the host.
 *
 * Providers describe the same three situations with dozens of words: IN_QUEUE, PENDING, processing,
 * SUBMITTED, RUNNING for one of them alone. Each plugin used to decide privately which words it
 * recognised and let the rest mean "not finished yet", which is the wrong default in the one
 * direction that costs money — a status nobody described became an unbounded wait for work that had
 * already died.
 *
 * So the vocabulary is ours and the mapping is the plugin's. It knows its provider; it does not get
 * to invent a fourth state.
 */
export const PROVIDER_LIFECYCLE_STATES = ['running', 'completed', 'failed'] as const;

export const ProviderLifecycleStateSchema = z.enum(PROVIDER_LIFECYCLE_STATES);
export type ProviderLifecycleState = z.infer<typeof ProviderLifecycleStateSchema>;

/**
 * Which of a provider's words mean each state.
 *
 * Every state needs at least one word. A mapping with no failure words cannot report a failure, so
 * a dead job would poll until the host's deadline instead of surfacing immediately — the deadline
 * exists for silence, not as a substitute for reading what the provider said.
 */
export const ProviderStatusMappingSchema = z.object({
  running: z.array(z.string().trim().min(1)).nonempty(),
  completed: z.array(z.string().trim().min(1)).nonempty(),
  failed: z.array(z.string().trim().min(1)).nonempty(),
}).strict().superRefine((mapping, ctx) => {
  const seen = new Map<string, ProviderLifecycleState>();
  for (const state of PROVIDER_LIFECYCLE_STATES) {
    for (const word of mapping[state]) {
      const normalized = normalizeStatus(word);
      const owner = seen.get(normalized);
      if (owner && owner !== state) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [state],
          message:
            `"${word}" is claimed by both ${owner} and ${state}. Which one wins would depend on `
            + 'iteration order, so the provider would appear to finish or fail at random.',
        });
      }
      seen.set(normalized, state);
    }
  }
});

export type ProviderStatusMapping = z.infer<typeof ProviderStatusMappingSchema>;

/**
 * Providers vary the same word freely — padded here, lowercased there between model families —
 * and none of those differences carry meaning. Normalising is not loosening: the comparison is
 * still exact, both sides are just spelled the same way first.
 */
function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

export interface ProviderStatusVerdict {
  state: ProviderLifecycleState;
  /** True when the provider said something the mapping does not cover. */
  unmapped: boolean;
  /** Present when the verdict needs explaining, i.e. when nothing matched. */
  reason?: string;
}

/**
 * Reads one provider status against a plugin's declared mapping.
 *
 * An unrecognised status resolves to `failed`, not to `running`. This is the whole point of the
 * exercise, and it is deliberately the less convenient answer: an incomplete mapping now costs one
 * surfaced error that names the offending word, where before it cost an indefinite wait that named
 * nothing. A plugin author who sees the word can add it; nobody can act on silence.
 */
export function classifyProviderStatus(
  status: string,
  mapping: ProviderStatusMapping,
): ProviderStatusVerdict {
  const normalized = normalizeStatus(status);
  for (const state of PROVIDER_LIFECYCLE_STATES) {
    if (mapping[state].some((word) => normalizeStatus(word) === normalized)) {
      return { state, unmapped: false };
    }
  }
  return {
    state: 'failed',
    unmapped: true,
    reason:
      `Provider reported "${status}", which this plugin's status mapping does not describe. `
      + 'Treating an undescribed status as still-running would wait indefinitely on work that may '
      + 'already have failed.',
  };
}
