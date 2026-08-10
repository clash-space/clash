export type LocalSpeechCapability = 'speech-to-text' | 'text-to-speech';

/**
 * One source of truth for "which catalog entry is a local speech model, and what
 * runtime model id does it install as".
 *
 * This deliberately lives beside the model cards rather than inside a UI
 * component: when only the GUI could answer it, the CLI could not tell a user
 * that Whisper was available at all.
 */

type CatalogRoute = {
  apiShape?: unknown;
  upstreamModel?: unknown;
};

export type LocalSpeechCatalogEntry = {
  model: {
    id: string;
    kind?: unknown;
    name?: unknown;
    provider?: unknown;
    description?: unknown;
    promptGuidance?: unknown;
    defaultParams?: unknown;
  };
  selectedRoute?: CatalogRoute | null;
  routes?: CatalogRoute[];
  candidateProviders?: unknown[];
};

export function isLocalAsrModelEntry(entry: LocalSpeechCatalogEntry): boolean {
  return (entry.model.kind as string) === 'asr' && (
    (entry.selectedRoute?.apiShape as string | undefined) === 'local-asr' ||
    (entry.candidateProviders ?? []).map(String).includes('local')
  );
}

export function isLocalTtsModelEntry(entry: LocalSpeechCatalogEntry): boolean {
  return (entry.selectedRoute?.apiShape as string | undefined) === 'local-tts' ||
    (entry.routes ?? []).some((route) => (route.apiShape as string | undefined) === 'local-tts');
}

export function isLocalSpeechModelEntry(entry: LocalSpeechCatalogEntry): boolean {
  return isLocalAsrModelEntry(entry) || isLocalTtsModelEntry(entry);
}

export function localSpeechCapability(
  entry: LocalSpeechCatalogEntry,
): LocalSpeechCapability | null {
  if (isLocalAsrModelEntry(entry)) return 'speech-to-text';
  if (isLocalTtsModelEntry(entry)) return 'text-to-speech';
  return null;
}

function defaultParamModel(entry: LocalSpeechCatalogEntry, key: string): string | undefined {
  const defaultParams = entry.model.defaultParams as Record<string, unknown> | undefined;
  const value = defaultParams?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function asrModelValue(entry: LocalSpeechCatalogEntry): string {
  if (typeof entry.selectedRoute?.upstreamModel === 'string' && entry.selectedRoute.upstreamModel) {
    return entry.selectedRoute.upstreamModel;
  }
  return defaultParamModel(entry, 'asr_model') ?? entry.model.id;
}

export function ttsModelValue(entry: LocalSpeechCatalogEntry): string {
  if (typeof entry.selectedRoute?.upstreamModel === 'string' && entry.selectedRoute.upstreamModel) {
    return entry.selectedRoute.upstreamModel;
  }
  return defaultParamModel(entry, 'tts_model') ?? entry.model.id;
}

/** The runtime model id a catalog entry installs as, whichever capability it is. */
export function localSpeechModelValue(entry: LocalSpeechCatalogEntry): string {
  return isLocalTtsModelEntry(entry) ? ttsModelValue(entry) : asrModelValue(entry);
}

export type LocalSpeechModelCard = {
  /** Catalog id, for example `whisper-small-asr`. */
  cardId: string;
  /** Runtime id the local runtime installs, for example `mlx-community/whisper-small-mlx`. */
  model: string;
  capability: LocalSpeechCapability;
  name?: string;
  provider?: string;
  description?: string;
  guidance?: string;
};

export function localSpeechModelCard(
  entry: LocalSpeechCatalogEntry,
): LocalSpeechModelCard | undefined {
  const capability = localSpeechCapability(entry);
  if (!capability) return undefined;
  return {
    cardId: entry.model.id,
    model: localSpeechModelValue(entry),
    capability,
    ...(typeof entry.model.name === 'string' ? { name: entry.model.name } : {}),
    ...(typeof entry.model.provider === 'string' ? { provider: entry.model.provider } : {}),
    ...(typeof entry.model.description === 'string' ? { description: entry.model.description } : {}),
    ...(typeof entry.model.promptGuidance === 'string' ? { guidance: entry.model.promptGuidance } : {}),
  };
}

export function listLocalSpeechModelCards(
  entries: LocalSpeechCatalogEntry[],
  capability?: LocalSpeechCapability,
): LocalSpeechModelCard[] {
  return entries.flatMap((entry) => {
    const card = localSpeechModelCard(entry);
    if (!card) return [];
    if (capability && card.capability !== capability) return [];
    return [card];
  });
}

/** Resolve either a catalog card id or a runtime model id to a runtime model id. */
export function resolveLocalSpeechModelId(
  entries: LocalSpeechCatalogEntry[],
  capability: LocalSpeechCapability,
  requested: string,
): string | undefined {
  const cards = listLocalSpeechModelCards(entries, capability);
  const wanted = requested.trim();
  return cards.find((card) => card.cardId === wanted)?.model
    ?? cards.find((card) => card.model === wanted)?.model;
}
