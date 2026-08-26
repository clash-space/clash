export const semanticTones = [
  "coral",
  "blue",
  "sage",
  "lilac",
  "amber",
  "teal",
] as const;

export type SemanticTone = (typeof semanticTones)[number];

export const semanticToneSoftClasses = {
  coral: "border-transparent bg-tone-coral-soft text-tone-coral-ink",
  blue: "border-transparent bg-tone-blue-soft text-tone-blue-ink",
  sage: "border-transparent bg-tone-sage-soft text-tone-sage-ink",
  lilac: "border-transparent bg-tone-lilac-soft text-tone-lilac-ink",
  amber: "border-transparent bg-tone-amber-soft text-tone-amber-ink",
  teal: "border-transparent bg-tone-teal-soft text-tone-teal-ink",
} satisfies Record<SemanticTone, string>;

export const semanticToneSurfaceClasses = {
  coral: "border-transparent bg-tone-coral-soft text-tone-coral-ink",
  blue: "border-transparent bg-tone-blue-soft text-tone-blue-ink",
  sage: "border-transparent bg-tone-sage-soft text-tone-sage-ink",
  lilac: "border-transparent bg-tone-lilac-soft text-tone-lilac-ink",
  amber: "border-transparent bg-tone-amber-soft text-tone-amber-ink",
  teal: "border-transparent bg-tone-teal-soft text-tone-teal-ink",
} satisfies Record<SemanticTone, string>;
