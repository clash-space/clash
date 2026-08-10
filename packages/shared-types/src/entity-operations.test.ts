import { describe, expect, it } from 'vitest';

import {
  ENTITY_OPERATIONS,
  EntityOperationSchema,
  ExecutablePluginEntityExportSchema,
} from './entity-operations';

/**
 * Everything a plugin can do to an entity is one of a closed set of operations.
 *
 * Two first-party plugins grew a command each per verb -- `timeline create/attach/detach/render`
 * and `director create/attach/detach/capture` -- and the pair that was genuinely identical,
 * `pull`/`apply`, was already reachable through `projection`. What remains is not per-entity
 * either: `render` and `capture` are the same shape (entity plus parameters produces an asset), and
 * `create`/`attach`/`detach` are lifecycle that reads the same for any entity.
 *
 * Producing is not in the set. The canvas already has one mechanism for it: a node carries
 * parameters and, executed, spawns a pending asset child. An action badge does this with a Model
 * Card's parameters; a `video-editor` node does it with `data.timelineId`. `timeline render` reaches
 * that same path through a second command, which is why it grew its own receipt and waiting flags.
 * So an entity declares the node type it appears as, and producing is `canvas execute` on that node.
 *
 * A closed enum rather than a free-form verb, for the same reason `source` is closed: the host owns
 * what each operation means -- who may run it, what it costs, how its result enters the CAS. A
 * plugin declaring an arbitrary verb would be declaring behaviour the host cannot reason about, and
 * `clash production` already demonstrated where that leads: forty-four subcommands, each a verb, all
 * eventually deleted.
 */
describe('entity operations', () => {
  it('closes the set at lifecycle', () => {
    expect([...ENTITY_OPERATIONS].sort()).toEqual(['attach', 'create', 'detach']);
  });

  it('rejects a verb outside the set', () => {
    for (const verb of ['render', 'capture', 'produce', 'publish', 'compile']) {
      expect(EntityOperationSchema.safeParse(verb).success, verb).toBe(false);
    }
  });

  it('does not list pull or apply, which the projection loop already owns', () => {
    expect(ENTITY_OPERATIONS).not.toContain('pull');
    expect(ENTITY_OPERATIONS).not.toContain('apply');
  });

  it('lets a plugin declare an entity with the operations it supports', () => {
    const parsed = ExecutablePluginEntityExportSchema.parse({
      entity: 'timeline',
      title: 'Project Timeline',
      operations: ['create', 'attach', 'detach'],
      canvasNodeType: 'video-editor',
    });
    expect(parsed.canvasNodeType).toBe('video-editor');
  });

  it('requires a canvas node type exactly when the entity can be attached', () => {
    // Attaching has nothing to place without one, and the node type is also what makes the entity
    // executable, so producing needs no separate declaration.
    expect(() => ExecutablePluginEntityExportSchema.parse({
      entity: 'timeline',
      title: 'Project Timeline',
      operations: ['attach'],
    })).toThrow(/canvasNodeType/i);

    expect(() => ExecutablePluginEntityExportSchema.parse({
      entity: 'notes',
      title: 'Notes',
      operations: ['create'],
      canvasNodeType: 'video-editor',
    })).toThrow(/canvasNodeType/i);
  });

  it('accepts an entity that only exists to be edited', () => {
    // Projection is not an operation here: a kind is projectable by declaring a projection, and an
    // entity may be editable without supporting any lifecycle verb at all.
    const parsed = ExecutablePluginEntityExportSchema.parse({
      entity: 'notes',
      title: 'Notes',
      operations: [],
    });
    expect(parsed.operations).toEqual([]);
  });
});
