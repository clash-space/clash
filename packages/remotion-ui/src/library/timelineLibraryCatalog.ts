import type { Asset } from '@clash/remotion-core';
import {
  builtInEffectRegistry,
  type EffectDefinition,
} from '@clash/remotion-effects';
import {
  TIMELINE_LIBRARY_GROUPS,
  parseTimelineLibraryItem,
  type TimelineLibraryCategory,
  type TimelineLibraryItem,
} from '@clash/shared-types/timeline-library';

export type TimelineLibraryPreview = {
  kind: 'text' | 'image' | 'motion' | 'transition' | 'effect' | 'audio';
  src?: string;
  colors?: readonly [string, string];
  waveform?: number[];
};

export type TimelineLibraryCatalogRecord = {
  item: TimelineLibraryItem;
  preview: TimelineLibraryPreview;
  runtimeAsset?: Asset;
};

export type TimelineLibraryQuery = {
  groupId?: (typeof TIMELINE_LIBRARY_GROUPS)[number]['id'];
  categories?: TimelineLibraryCategory[];
  search?: string;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    encoded += BASE64_ALPHABET[(combined >> 18) & 63];
    encoded += BASE64_ALPHABET[(combined >> 12) & 63];
    encoded += index + 1 < bytes.length ? BASE64_ALPHABET[(combined >> 6) & 63] : '=';
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[combined & 63] : '=';
  }
  return encoded;
}

function makeToneAsset(options: {
  id: string;
  name: string;
  frequency: number;
  durationSeconds: number;
  shape: 'sine' | 'click' | 'rise';
}): Asset {
  const sampleRate = 8_000;
  const sampleCount = Math.max(1, Math.round(sampleRate * options.durationSeconds));
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount * 2, true);

  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / Math.max(1, sampleCount - 1);
    const envelope = options.shape === 'click'
      ? Math.exp(-progress * 36)
      : options.shape === 'rise'
        ? Math.sin(progress * Math.PI) ** 0.65
        : Math.exp(-progress * 7);
    const frequency = options.shape === 'rise'
      ? options.frequency * (0.72 + progress * 1.9)
      : options.frequency;
    const sample = Math.sin(2 * Math.PI * frequency * (index / sampleRate)) * envelope * 0.58;
    samples.push(sample);
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }

  const waveform = Array.from({ length: 64 }, (_, bucket) => {
    const start = Math.floor((bucket / 64) * samples.length);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / 64) * samples.length));
    let peak = 0;
    for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index] ?? 0));
    return peak;
  });

  return {
    id: options.id,
    name: options.name,
    type: 'audio',
    src: `data:audio/wav;base64,${bytesToBase64(bytes)}`,
    duration: options.durationSeconds,
    waveform,
    createdAt: 0,
  };
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const stickerSources = {
  spark: svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#ff6b50" d="m128 12 20 78 76-34-53 61 72 41-82-9 6 83-39-73-54 63 27-79-84-2 77-35-50-67 69 49z"/><circle cx="128" cy="128" r="27" fill="#fff6e9"/></svg>'),
  heart: svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#ff7e91" stroke="#512f2c" stroke-width="10" d="M128 224S28 163 28 84c0-58 72-73 100-27 28-46 100-31 100 27 0 79-100 140-100 140z"/></svg>'),
  bubble: svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#9bded5" stroke="#234e52" stroke-width="9" d="M28 35h200v145H104l-55 42 13-42H28z"/><circle cx="83" cy="108" r="12" fill="#234e52"/><circle cx="128" cy="108" r="12" fill="#234e52"/><circle cx="173" cy="108" r="12" fill="#234e52"/></svg>'),
} as const;

function titleCaseEffectId(effectId: string): string {
  return effectId
    .split('/').pop()!
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function defaultEffectParams(definition: EffectDefinition): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(definition.params).map(([name, parameter]) => [name, parameter.default]),
  );
}

function effectRecord(options: {
  category: 'fx' | 'zoom' | 'luts' | 'filters' | 'adjustments';
  effectId: string;
  label?: string;
  description: string;
  tags: string[];
  colors: readonly [string, string];
}): TimelineLibraryCatalogRecord {
  const definition = builtInEffectRegistry.resolve(options.effectId, 1);
  const apply = options.category === 'luts' || options.category === 'filters'
    ? { kind: 'attach-color-look' as const, binding: 'item' as const }
    : {
        kind: 'attach-visual-effect' as const,
        binding: options.category === 'zoom' ? 'track-range' as const : options.category === 'adjustments' ? 'item' as const : 'item-or-range' as const,
      };
  return {
    item: parseTimelineLibraryItem({
      id: `library:${options.category}:${definition.id.replace('/', ':')}`,
      version: definition.version,
      label: options.label ?? titleCaseEffectId(definition.id),
      description: options.description,
      category: options.category,
      tags: ['bundled', 'curated', ...options.tags],
      artifact: {
        kind: 'effect-ref',
        effectId: definition.id,
        effectVersion: definition.version,
        params: defaultEffectParams(definition),
      },
      apply,
      provenance: definition.provenance,
      agent: {
        description: options.description,
        searchTerms: [options.label ?? titleCaseEffectId(definition.id), ...options.tags],
        catalogFirst: true,
      },
    }),
    preview: { kind: 'effect', colors: options.colors },
  };
}

const rawRecords: TimelineLibraryCatalogRecord[] = [
  ...[
    ['Editorial Title', 'YOUR STORY', 82, '800'],
    ['Clean Subtitle', 'Say it clearly', 54, '700'],
    ['Chapter Label', 'CHAPTER 01', 42, '650'],
  ].map(([label, text, fontSize, fontWeight], index): TimelineLibraryCatalogRecord => ({
    item: parseTimelineLibraryItem({
      id: `library:text:${String(label).toLowerCase().replace(/\s+/g, '-')}`,
      version: 1,
      label,
      description: `Insert a ${String(label).toLowerCase()} on a typed text lane.`,
      category: 'text',
      tags: ['bundled', 'curated', index === 1 ? 'subtitle' : 'title'],
      artifact: { kind: 'text-preset', text, color: '#ffffff', fontSize, fontWeight },
      apply: { kind: 'insert-text-item' },
      agent: { description: `Add ${label}`, searchTerms: [String(label), String(text)], catalogFirst: true },
    }),
    preview: { kind: 'text', colors: index === 1 ? ['#13233b', '#ff6b50'] : ['#ff6b50', '#fff8f1'] },
  })),
  ...Object.entries(stickerSources).map(([name, src]): TimelineLibraryCatalogRecord => ({
    item: parseTimelineLibraryItem({
      id: `library:sticker:${name}`,
      version: 1,
      label: name.charAt(0).toUpperCase() + name.slice(1),
      description: `Bundled vector ${name} sticker.`,
      category: 'stickers',
      tags: ['bundled', 'curated', 'vector', 'reaction'],
      artifact: { kind: 'sticker-asset', src },
      apply: { kind: 'insert-sticker-item' },
      agent: { description: `Add a ${name} sticker`, searchTerms: [name, 'sticker', 'reaction'], catalogFirst: true },
    }),
    preview: { kind: 'image', src },
  })),

];

const soundDefinitions = [
  { id: 'library:sound:mouse-click', name: 'Mouse Click', frequency: 1_350, durationSeconds: 0.12, shape: 'click' as const, tags: ['ui', 'click'] },
  { id: 'library:sound:notification-ping', name: 'Notification Ping', frequency: 760, durationSeconds: 0.34, shape: 'sine' as const, tags: ['ui', 'notification'] },
  { id: 'library:sound:short-whoosh', name: 'Short Whoosh', frequency: 220, durationSeconds: 0.48, shape: 'rise' as const, tags: ['transition', 'whoosh'] },
];

for (const definition of soundDefinitions) {
  const asset = makeToneAsset(definition);
  rawRecords.push({
    item: parseTimelineLibraryItem({
      id: definition.id,
      version: 1,
      label: definition.name,
      description: `Bundled deterministic ${definition.name.toLowerCase()} sound effect.`,
      category: 'sound-effects',
      tags: ['bundled', 'curated', ...definition.tags],
      artifact: { kind: 'audio-asset', assetId: definition.id },
      apply: { kind: 'insert-audio-item' },
      agent: { description: `Add ${definition.name}`, searchTerms: [definition.name, ...definition.tags], catalogFirst: true },
    }),
    preview: { kind: 'audio', waveform: asset.waveform },
    runtimeAsset: asset,
  });
}

for (const definition of builtInEffectRegistry.list({ kind: 'transition' })) {
  rawRecords.push({
    item: parseTimelineLibraryItem({
      id: `library:transition:${definition.id.replace('/', ':')}`,
      version: definition.version,
      label: titleCaseEffectId(definition.id),
      description: definition.capabilities.webgl2
        ? 'Curated GPU transition with deterministic Remotion fallback.'
        : 'Fast deterministic transition for adjacent visual clips.',
      category: 'transitions',
      tags: ['bundled', 'curated', definition.capabilities.webgl2 ? 'shader' : 'classic'],
      artifact: {
        kind: 'effect-ref',
        effectId: definition.id,
        effectVersion: definition.version,
        params: defaultEffectParams(definition),
      },
      apply: { kind: 'attach-transition', binding: 'between-items' },
      provenance: definition.provenance,
      agent: {
        description: `Transition adjacent clips with ${titleCaseEffectId(definition.id)}`,
        searchTerms: [titleCaseEffectId(definition.id), 'transition', definition.capabilities.webgl2 ? 'shader' : 'classic'],
        catalogFirst: true,
      },
    }),
    preview: {
      kind: 'transition',
      colors: definition.capabilities.webgl2 ? ['#ff6b50', '#4f6ea9'] : ['#f5d8cf', '#8fb7b0'],
    },
  });
}

rawRecords.push(
  effectRecord({ category: 'fx', effectId: 'clash/camera-shake', description: 'Deterministic handheld camera movement.', tags: ['motion', 'handheld'], colors: ['#e8d6c8', '#38516b'] }),
  effectRecord({ category: 'fx', effectId: 'clash/soft-glow', description: 'A restrained highlight bloom look.', tags: ['glow', 'soft'], colors: ['#f8d49a', '#ff6b50'] }),
  effectRecord({ category: 'fx', effectId: 'clash/tilt-shift', description: 'Soft miniature-style focus treatment.', tags: ['blur', 'focus'], colors: ['#9fcac1', '#44556d'] }),
  effectRecord({ category: 'zoom', effectId: 'clash/punch-zoom', description: 'Short editorial emphasis zoom.', tags: ['punch', 'emphasis'], colors: ['#ff6b50', '#fff2e8'] }),
  effectRecord({ category: 'zoom', effectId: 'clash/slow-drift', description: 'Slow Ken Burns-style camera drift.', tags: ['ken burns', 'drift'], colors: ['#698aa8', '#d7e5dd'] }),
  effectRecord({ category: 'filters', effectId: 'clash/warm-film', description: 'Warm, gently saturated editorial filter.', tags: ['warm', 'film'], colors: ['#e5a66c', '#774b42'] }),
  effectRecord({ category: 'filters', effectId: 'clash/cool-clean', description: 'Cool neutral commercial filter.', tags: ['cool', 'clean'], colors: ['#8db7ca', '#273c55'] }),
  effectRecord({ category: 'filters', effectId: 'clash/monochrome', description: 'Crisp monochrome treatment.', tags: ['black and white', 'mono'], colors: ['#e8e4df', '#343434'] }),
  effectRecord({ category: 'luts', effectId: 'clash/warm-film', label: 'Warm 35mm Look', description: 'Built-in color look represented as a versioned effect reference.', tags: ['lut', 'warm', '35mm'], colors: ['#efc18e', '#75463f'] }),
  effectRecord({ category: 'luts', effectId: 'clash/cool-clean', label: 'Clean Daylight Look', description: 'Built-in daylight color look.', tags: ['lut', 'daylight', 'clean'], colors: ['#b8d6dd', '#37556a'] }),
  effectRecord({ category: 'adjustments', effectId: 'clash/adjust-exposure', label: 'Exposure +', description: 'Increase exposure with a bounded, inspectable parameter.', tags: ['brightness', 'exposure'], colors: ['#f4e6d4', '#fffdf7'] }),
  effectRecord({ category: 'adjustments', effectId: 'clash/adjust-saturation', label: 'Saturation +', description: 'Increase color saturation.', tags: ['color', 'saturation'], colors: ['#e55e75', '#56a7a1'] }),
  effectRecord({ category: 'adjustments', effectId: 'clash/adjust-contrast', label: 'Contrast +', description: 'Increase tonal contrast.', tags: ['contrast', 'tone'], colors: ['#e9e2d8', '#2d3541'] }),
);

for (const [id, label, description, tags] of [
  ['clash/audio-fade-in', 'Audio Fade In', 'Apply a short fade-in to the selected audio item.', ['fade', 'soft']],
  ['clash/audio-fade-out', 'Audio Fade Out', 'Apply a short fade-out to the selected audio item.', ['fade', 'ending']],
  ['clash/voice-boost', 'Voice Boost', 'Raise selected dialogue volume with headroom.', ['voice', 'dialogue']],
] as const) {
  rawRecords.push({
    item: parseTimelineLibraryItem({
      id: `library:audio-fx:${id.replace('/', ':')}`,
      version: 1,
      label,
      description,
      category: 'audio-fx',
      tags: ['bundled', 'curated', ...tags],
      artifact: { kind: 'audio-processor-ref', processorId: id, processorVersion: 1 },
      apply: { kind: 'attach-audio-effect', binding: 'audio-item-or-track' },
      agent: { description, searchTerms: [label, ...tags], catalogFirst: true },
    }),
    preview: { kind: 'audio', waveform: Array.from({ length: 32 }, (_, index) => Math.sin((index / 31) * Math.PI) * 0.8) },
  });
}

for (const caption of [
  { id: 'clean', label: 'Clean Captions', style: { color: '#ffffff', backgroundColor: 'rgba(12,18,28,0.62)', fontSize: 52, fontWeight: 700, position: 'bottom' as const } },
  { id: 'creator', label: 'Creator Pop', style: { color: '#172033', backgroundColor: '#fff3a8', fontSize: 58, fontWeight: 800, position: 'bottom' as const } },
  { id: 'minimal', label: 'Minimal White', style: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0)', fontSize: 48, fontWeight: 650, position: 'center' as const } },
]) {
  rawRecords.push({
    item: parseTimelineLibraryItem({
      id: `library:caption:${caption.id}`,
      version: 1,
      label: caption.label,
      description: `Apply ${caption.label.toLowerCase()} styling to selected subtitle text.`,
      category: 'captions',
      tags: ['bundled', 'curated', 'caption', 'typography', caption.id],
      artifact: { kind: 'caption-style', style: caption.style },
      apply: { kind: 'update-caption-style' },
      agent: { description: `Style captions as ${caption.label}`, searchTerms: [caption.label, 'caption', 'subtitle', 'typography'], catalogFirst: true },
    }),
    preview: { kind: 'text', colors: [caption.style.backgroundColor, caption.style.color] },
  });
}

export const TIMELINE_LIBRARY_CATALOG = rawRecords.sort((left, right) =>
  left.item.label.localeCompare(right.item.label),
);

export function queryTimelineLibrary(query: TimelineLibraryQuery = {}): TimelineLibraryCatalogRecord[] {
  const group = query.groupId
    ? TIMELINE_LIBRARY_GROUPS.find((candidate) => candidate.id === query.groupId)
    : undefined;
  const requestedCategories = query.categories?.length
    ? new Set(query.categories)
    : group && group.categories.length > 0
      ? new Set<TimelineLibraryCategory>(group.categories)
      : null;
  const needle = query.search?.trim().toLocaleLowerCase() ?? '';

  return TIMELINE_LIBRARY_CATALOG.filter((record) => {
    if (requestedCategories && !requestedCategories.has(record.item.category)) return false;
    if (!needle) return true;
    const searchable = [
      record.item.label,
      record.item.description,
      ...record.item.tags,
      ...(record.item.agent?.searchTerms ?? []),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return searchable.includes(needle);
  });
}
