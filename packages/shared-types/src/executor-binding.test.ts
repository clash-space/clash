import { describe, expect, it } from 'vitest';

import { MODEL_CARDS } from './models.js';

/**
 * A plugin executor that nothing routes to is not in the product.
 *
 * Four executors exist and are tested — fal, MiniMax, Google, mock — and until a route names one,
 * every generation still goes through the host's built-in path. The Google executor was verified
 * against the live API, returning a 1216KB PNG, while the product continued to answer the same model
 * from `local-aigc`. Two implementations, one of them unreachable, and no test could tell.
 *
 * The plugin id is checked as well as the export id. Google moved out of `clash.media` into its own
 * `clash.google` plugin, because a Provider is a plugin: installing Google out of the shared one
 * also installed fal, MiniMax and the mock, and a route naming `clash.media` named a plugin that
 * mostly served somebody else.
 */
describe('routes bind to plugin executors', () => {
  const routes = MODEL_CARDS.flatMap((card) => card.providerImplementations ?? []);

  it('gives every media-capable plugin route an Asset delivery for each accepted kind', () => {
    const uncovered = MODEL_CARDS.flatMap((card) => {
      const inputMode = card.input.inputMode;
      const acceptedKinds = [
        ...(inputMode.images || inputMode.startEnd ? ['image' as const] : []),
        ...(inputMode.videos ? ['video' as const] : []),
        ...(inputMode.audios ? ['audio' as const] : []),
      ];
      if (acceptedKinds.length === 0) return [];

      return (card.providerImplementations ?? [])
        .filter((route) => route.executorPluginId)
        .flatMap((route) => acceptedKinds
          .filter((kind) => !(route.assetInputs ?? []).some((delivery) =>
            !delivery.match.kinds?.length || delivery.match.kinds.includes(kind),
          ))
          .map((kind) => `${card.id}:${route.providerId}:${kind}`));
    });

    expect(uncovered).toEqual([]);
  });

  it('sends generateContent models to the google executor', () => {
    const google = routes.filter((route) => route.apiShape === 'google-ai-studio');
    expect(google.length).toBeGreaterThan(0);
    for (const route of google) {
      expect(route.executorExportId).toBe('google-execute');
      expect(route.executorPluginId).toBe('clash.google');
    }
  });

  it('sends the interactions surface to the Google executor', () => {
    const interactions = routes.filter((route) => route.apiShape === 'google-ai-studio-interactions');
    expect(interactions.length).toBeGreaterThan(0);
    for (const route of interactions) {
      expect(route.executorExportId).toBe('google-execute');
      expect(route.executorPluginId).toBe('clash.google');
    }
  });

  it('sends only MiniMax API routes to the MiniMax executor', () => {
    const minimax = routes.filter((route) => route.apiShape === 'minimax');
    expect(minimax.length).toBeGreaterThan(0);
    for (const route of minimax) {
      expect(route.executorExportId).toBe('minimax-execute');
      expect(route.executorPluginId).toBe('clash.minimax');
    }

    for (const route of routes.filter((route) => route.apiShape !== 'minimax')) {
      expect(route.executorPluginId).not.toBe('clash.minimax');
    }
  });

  it("sends every Pika API Club route to the Pika executor", () => {
    const pika = routes.filter(
      (route) =>
        route.providerId === "pika" &&
        (route.apiShape === "pika" || route.apiShape === "pika-chat"),
    );
    expect(pika.length).toBeGreaterThan(0);
    for (const route of pika) {
      expect(route.executorExportId).toBe("pika-execute");
      expect(route.executorPluginId).toBe("clash.pika");
    }
  });

  it("routes MiniMax M3 text generation through the official MiniMax executor", () => {
    const card = MODEL_CARDS.find((candidate) => candidate.id === "minimax-m3");
    expect(card).toMatchObject({
      kind: 'text',
      availableProviders: ['minimax'],
      defaultProvider: 'minimax',
    });
    expect(card?.providerImplementations).toContainEqual(expect.objectContaining({
      providerId: 'minimax',
      apiShape: 'minimax',
      upstreamModel: 'MiniMax-M3',
      executorPluginId: 'clash.minimax',
      executorExportId: 'minimax-execute',
    }));
  });
});
