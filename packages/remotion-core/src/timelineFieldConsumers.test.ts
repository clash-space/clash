import { describe, expect, it } from 'vitest';
import { TIMELINE_DSL_FIELD_ANNOTATIONS } from '@clash/shared-types';
import * as core from './index';

describe('timeline field consumer contract', () => {
  it('publishes the closed consumer-kind vocabulary and exhaustive labels', () => {
    const kinds = (
      core as unknown as { TIMELINE_FIELD_CONSUMER_KINDS?: readonly string[] }
    ).TIMELINE_FIELD_CONSUMER_KINDS ?? [];
    const label = (
      core as unknown as { timelineFieldConsumerKindLabel?: (kind: string) => string }
    ).timelineFieldConsumerKindLabel ?? (() => 'missing');

    expect(kinds).toEqual([
      'rendered',
      'editor',
      'meta',
      'persistence',
      'future',
      'unsupported',
    ]);
    expect(kinds.map(label)).toEqual([
      'Rendered output',
      'Editor surface',
      'Runtime metadata',
      'Persistence only',
      'Reserved for future support',
      'Explicitly unsupported',
    ]);
  });

  it('publishes one caption style default consumed by editor and renderer', () => {
    const defaults = (
      core as unknown as { TIMELINE_CAPTION_STYLE_DEFAULTS?: Record<string, unknown> }
    ).TIMELINE_CAPTION_STYLE_DEFAULTS ?? {};

    expect(defaults).toEqual({
      position: 'bottom',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.56)',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 52,
      fontWeight: 700,
      lineHeight: 1.18,
    });
  });

  it('snapshots every shared item fallback with schema-valid values', () => {
    const snapshot = (
      core as unknown as { TIMELINE_SHARED_DEFAULTS?: Record<string, Record<string, unknown>> }
    ).TIMELINE_SHARED_DEFAULTS ?? {};
    const annotatedDefaults = Object.fromEntries(
      Object.entries({
        root: TIMELINE_DSL_FIELD_ANNOTATIONS.root,
        track: TIMELINE_DSL_FIELD_ANNOTATIONS.track,
        itemBase: TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase,
        ...TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes,
      }).flatMap(([scope, fields]) => {
        const defaults = Object.fromEntries(
          Object.entries(fields)
            .filter(([, annotation]) => Object.prototype.hasOwnProperty.call(annotation, 'defaultValue'))
            .map(([field, annotation]) => {
              expect(annotation.schema.safeParse(annotation.defaultValue).success, `${scope}.${field}`)
                .toBe(true);
              return [field, annotation.defaultValue];
            }),
        );
        return Object.keys(defaults).length > 0 ? [[scope, defaults]] : [];
      }),
    );

    expect(snapshot).toEqual(annotatedDefaults);
  });
});
