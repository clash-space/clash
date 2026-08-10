/**
 * The K-tier resolution names, for the models that use them.
 *
 * This is not a normalization target. A provider's resolution options are a menu of
 * concrete outputs whose names are already exact -- `720p` is 1280x720, `fhd` is
 * 1920x1080, `768P` is MiniMax's own rung -- so cards carry their provider's values
 * and no adapter rewrites them. Folding those onto these tiers would assert false
 * equalities: a 1K budget is 1048576 pixels while 720p is 921600.
 *
 * These exist because some providers name K tiers themselves (nano-banana, seedream)
 * and because gpt-image-2 accepts arbitrary dimensions, so the product must choose
 * how much area to request. A tier is a pixel budget rather than a long edge: at a
 * fixed 2048 long edge, 1:1 is 4.2MP but 3:1 is only 1.4MP.
 */
export type CanonicalResolutionTier = '0.5K' | '1K' | '2K' | '4K';

export const CANONICAL_RESOLUTION_TIERS: ReadonlyArray<{
  label: string;
  value: CanonicalResolutionTier;
  /** Nominal pixel budget for the tier. */
  pixels: number;
}> = [
  { label: '0.5K (Draft)', value: '0.5K', pixels: 262_144 },
  { label: '1K (Fast)', value: '1K', pixels: 1_048_576 },
  { label: '2K (Balanced)', value: '2K', pixels: 4_194_304 },
  { label: '4K (High Quality)', value: '4K', pixels: 8_294_400 },
] as const;

/**
 * Provider spellings that mean one of the canonical tiers.
 *
 * Short-edge names are matched to the tier whose budget they land in at 16:9, the
 * ratio those names were coined for: 720 rows is 1280 columns, so `720p` is roughly
 * a megapixel and therefore the 1K tier.
 */
const RESOLUTION_TIER_ALIASES: Readonly<Record<string, CanonicalResolutionTier>> = {
  '360p': '0.5K',
  '480p': '0.5K',
  '540p': '0.5K',
  '720p': '1K',
  '768p': '1K',
  '1080p': '2K',
  '1440p': '2K',
  '2160p': '4K',
  '0.5k': '0.5K',
  '1k': '1K',
  '2k': '2K',
  '4k': '4K',
};


/** Pixel budget for a tier, for adapters that derive explicit dimensions. */
export function resolutionTierPixels(tier: CanonicalResolutionTier): number {
  return CANONICAL_RESOLUTION_TIERS.find(entry => entry.value === tier)?.pixels ?? 4_194_304;
}

