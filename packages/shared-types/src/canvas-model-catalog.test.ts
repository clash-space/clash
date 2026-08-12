import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';

import { Canvas } from './canvas-ops.js';
import { MODEL_CARDS } from './models.js';

/**
 * The effective model catalogue is composed at runtime, so `Canvas` must be told what it
 * is rather than reading the first-party constant.
 *
 * A plugin may ship model cards of its own (`exports.cards` with `kind: "model-card"`),
 * which means the set of usable models is only knowable where those plugins are
 * installed — the host. `Canvas` runs in three processes: the CLI, the local host, and
 * the web UI. While it read `MODEL_CARDS` directly, each process judged a generation
 * against its own compiled-in copy, so a stale client refused a model the host served:
 *
 *   CLI:  Unknown model: kling-image-o3
 *   host: kling-image-o3  available
 *
 * A client must not be able to veto what the authority allows.
 */
describe('Canvas resolves models against a supplied catalogue', () => {
  const pluginCard = {
    ...MODEL_CARDS.find(card => card.kind === 'image')!,
    id: 'plugin-only-image',
    aliases: [],
    name: 'Plugin Only Image',
  };

  function canvasWith(models?: readonly typeof pluginCard[]) {
    const doc = new LoroDoc();
    return new Canvas(doc, () => {}, 'main', models);
  }

  it('accepts a model that only exists in the supplied catalogue', () => {
    const canvas = canvasWith([pluginCard]);
    canvas.createNode('badge-1', 'action-badge', {
      actionType: 'image-gen',
      modelId: 'plugin-only-image',
      prompt: 'a lit workshop',
    });
    const result = canvas.executeGeneration('badge-1', () => 'asset-1');
    expect(result.error ?? null).toBeNull();
    expect(result.assetNodeId).toBeTruthy();
  });

  it('rejects a model absent from the supplied catalogue', () => {
    const canvas = canvasWith([pluginCard]);
    canvas.createNode('badge-2', 'action-badge', {
      actionType: 'image-gen',
      modelId: 'nano-banana-2',
      prompt: 'a lit workshop',
    });
    expect(canvas.executeGeneration('badge-2', () => 'asset-2').error).toMatch(/unknown model/i);
  });

  it('falls back to the first-party set when no catalogue is supplied', () => {
    // Existing callers keep working: the constant is the default, not the only source.
    const canvas = canvasWith();
    canvas.createNode('badge-3', 'action-badge', {
      actionType: 'image-gen',
      modelId: 'nano-banana-2',
      prompt: 'a lit workshop',
    });
    expect(canvas.executeGeneration('badge-3', () => 'asset-3').error ?? null).toBeNull();
  });
});
