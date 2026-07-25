import type { Item, TimelineDsl, Track } from './types';

export type NleTarget = 'premiere-pro' | 'final-cut-pro' | 'davinci-resolve';
export type NleAvailability = {
  target: NleTarget;
  applicationName: string;
  installed: boolean;
  applicationPath?: string;
};
export type NleHandoffDisposition = 'direct' | 'bake' | 'unsupported';

export type NleHandoffPreflightItem = {
  itemId: string;
  trackId: string;
  disposition: NleHandoffDisposition;
  reason: string;
  resolved: boolean;
};

export type NleHandoffPreflight = {
  target: NleTarget;
  summary: Record<NleHandoffDisposition, number>;
  items: NleHandoffPreflightItem[];
};

export type NleHandoffAsset = {
  token: string;
  source: string;
  filename: string;
};

export type NleHandoffDocument = {
  target: NleTarget;
  extension: 'otio' | 'fcpxml' | 'xml';
  content: string;
  assets: NleHandoffAsset[];
  preflight: NleHandoffPreflight;
};

type ExportClip = {
  id: string;
  name: string;
  trackId: string;
  trackName: string;
  trackIndex: number;
  mediaKind: 'video' | 'audio';
  from: number;
  duration: number;
  sourceStart: number;
  token: string;
  source: string;
};

function bakedSource(item: Item): string | undefined {
  if (item.bakedAssetPath?.trim()) return item.bakedAssetPath;
  if (item.type === 'composition' && item.renderedAssetPath?.trim()) return item.renderedAssetPath;
  return undefined;
}

function directSource(item: Item): string | undefined {
  if (item.type === 'video' || item.type === 'audio' || item.type === 'image' || item.type === 'derived-overlay') {
    return item.src?.trim() || undefined;
  }
  return undefined;
}

function itemDisposition(item: Item): Pick<NleHandoffPreflightItem, 'disposition' | 'reason' | 'resolved'> {
  if (item.effects?.length) {
    return {
      disposition: 'bake',
      reason: 'Shader and clip effects must be rendered for external editors.',
      resolved: Boolean(bakedSource(item)),
    };
  }
  if (item.type === 'composition') {
    return {
      disposition: 'bake',
      reason: 'Compositions must be rendered for external editors.',
      resolved: Boolean(bakedSource(item)),
    };
  }
  if (directSource(item)) {
    return { disposition: 'direct', reason: 'The source media remains editable.', resolved: true };
  }
  return {
    disposition: 'bake',
    reason: `${item.type} items have no portable NLE representation and must be rendered.`,
    resolved: Boolean(bakedSource(item)),
  };
}

export function preflightNleHandoff(timeline: TimelineDsl, target: NleTarget): NleHandoffPreflight {
  const items = timeline.tracks.flatMap((track) => track.items.map((item) => ({
    itemId: item.id,
    trackId: track.id,
    ...itemDisposition(item),
  })));
  return {
    target,
    summary: {
      direct: items.filter((item) => item.disposition === 'direct').length,
      bake: items.filter((item) => item.disposition === 'bake').length,
      unsupported: items.filter((item) => item.disposition === 'unsupported').length,
    },
    items,
  };
}

function sourceStart(item: Item): number {
  return item.type === 'video' || item.type === 'audio'
    ? Math.max(0, item.sourceStartInFrames ?? 0)
    : 0;
}

function mediaKind(item: Item, track: Track): 'video' | 'audio' {
  return item.type === 'audio' || track.category === 'audio' ? 'audio' : 'video';
}

function filenameFor(item: Item, source: string): string {
  const withoutQuery = source.split(/[?#]/, 1)[0] || '';
  const parts = withoutQuery.split('/').filter(Boolean);
  const last = decodeURIComponent(parts[parts.length - 1] || '');
  const fallbackExtension = mediaKind(item, { id: '', name: '', items: [] }) === 'audio' ? 'wav' : 'mov';
  const candidate = last.includes('.') ? last : `${item.id}.${fallbackExtension}`;
  return candidate.replace(/[^a-z0-9._-]+/gi, '-');
}

function collectClips(timeline: TimelineDsl): { clips: ExportClip[]; assets: NleHandoffAsset[] } {
  const assets: NleHandoffAsset[] = [];
  const clips: ExportClip[] = [];
  timeline.tracks.forEach((track, trackIndex) => {
    track.items.forEach((item) => {
      const disposition = itemDisposition(item);
      const source = disposition.disposition === 'direct' ? directSource(item) : bakedSource(item);
      if (!source) throw new Error(`${item.id} must be baked before opening this Timeline in an external editor.`);
      const token = `{{asset:${assets.length}}}`;
      assets.push({ token, source, filename: filenameFor(item, source) });
      clips.push({
        id: item.id,
        name: item.id,
        trackId: track.id,
        trackName: track.name,
        trackIndex,
        mediaKind: mediaKind(item, track),
        from: Math.max(0, item.from),
        duration: Math.max(1, item.durationInFrames),
        sourceStart: sourceStart(item),
        token,
        source,
      });
    });
  });
  return { clips, assets };
}

function xml(value: string): string {
  return value.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

function otioTime(value: number, fps: number) {
  return { OTIO_SCHEMA: 'RationalTime.1', value, rate: fps };
}

function serializeOtio(name: string, revisionId: string, timeline: TimelineDsl, clips: ExportClip[]): string {
  const tracks = timeline.tracks.map((track) => {
    let cursor = 0;
    const children: unknown[] = [];
    clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.from - b.from).forEach((clip) => {
      if (clip.from > cursor) {
        children.push({
          OTIO_SCHEMA: 'Gap.1',
          name: '',
          source_range: {
            OTIO_SCHEMA: 'TimeRange.1',
            start_time: otioTime(0, timeline.fps),
            duration: otioTime(clip.from - cursor, timeline.fps),
          },
          effects: [],
          markers: [],
          metadata: {},
        });
      }
      children.push({
        OTIO_SCHEMA: 'Clip.2',
        name: clip.name,
        media_reference: {
          OTIO_SCHEMA: 'ExternalReference.1',
          name: clip.name,
          target_url: clip.token,
          available_range: null,
          metadata: {},
        },
        source_range: {
          OTIO_SCHEMA: 'TimeRange.1',
          start_time: otioTime(clip.sourceStart, timeline.fps),
          duration: otioTime(clip.duration, timeline.fps),
        },
        effects: [],
        markers: [],
        metadata: { clash_item_id: clip.id },
      });
      cursor = Math.max(cursor, clip.from + clip.duration);
    });
    return {
      OTIO_SCHEMA: 'Track.1',
      name: track.name,
      kind: track.category === 'audio' ? 'Audio' : 'Video',
      children,
      source_range: null,
      effects: [],
      markers: [],
      metadata: { clash_track_id: track.id },
    };
  });
  return JSON.stringify({
    OTIO_SCHEMA: 'Timeline.1',
    name,
    global_start_time: otioTime(0, timeline.fps),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: tracks,
      source_range: null,
      effects: [],
      markers: [],
      metadata: {},
    },
    metadata: { clash_revision_id: revisionId },
  }, null, 2);
}

function fcpTime(frames: number, fps: number): string {
  return frames === 0 ? '0s' : `${frames}/${fps}s`;
}

function serializeFcpxml(name: string, revisionId: string, timeline: TimelineDsl, clips: ExportClip[]): string {
  const resources = clips.map((clip, index) =>
    `    <asset id="r${index + 2}" name="${xml(clip.name)}" src="${xml(clip.token)}" start="0s" duration="${fcpTime(clip.sourceStart + clip.duration, timeline.fps)}" hasVideo="${clip.mediaKind === 'video' ? '1' : '0'}" hasAudio="${clip.mediaKind === 'audio' ? '1' : '0'}"/>`,
  ).join('\n');
  const connected = clips.map((clip, index) =>
    `            <asset-clip ref="r${index + 2}" name="${xml(clip.name)}" lane="${clip.trackIndex + 1}" offset="${fcpTime(clip.from, timeline.fps)}" start="${fcpTime(clip.sourceStart, timeline.fps)}" duration="${fcpTime(clip.duration, timeline.fps)}"><note>Clash item ${xml(clip.id)}</note></asset-clip>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="Clash ${timeline.compositionWidth}x${timeline.compositionHeight}" frameDuration="1/${timeline.fps}s" width="${timeline.compositionWidth}" height="${timeline.compositionHeight}"/>
${resources}
  </resources>
  <library><event name="Clash"><project name="${xml(name)}"><sequence format="r1" duration="${fcpTime(timeline.durationInFrames, timeline.fps)}" tcStart="0s" tcFormat="NDF"><metadata><md key="com.clash.revision" value="${xml(revisionId)}"/></metadata><spine>
          <gap name="Clash Timeline" offset="0s" start="0s" duration="${fcpTime(timeline.durationInFrames, timeline.fps)}">
${connected}
          </gap>
        </spine></sequence></project></event></library>
</fcpxml>`;
}

function serializePremiereXml(name: string, revisionId: string, timeline: TimelineDsl, clips: ExportClip[]): string {
  const rate = `<rate><timebase>${timeline.fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const serializeTrack = (track: Track, kind: 'video' | 'audio') => {
    const items = clips.filter((clip) => clip.trackId === track.id && clip.mediaKind === kind).map((clip, index) => `
          <clipitem id="clip-${xml(clip.id)}"><name>${xml(clip.name)}</name><start>${clip.from}</start><end>${clip.from + clip.duration}</end><in>${clip.sourceStart}</in><out>${clip.sourceStart + clip.duration}</out>${rate}<file id="file-${xml(track.id)}-${index}"><name>${xml(clip.name)}</name><pathurl>${xml(clip.token)}</pathurl>${rate}<duration>${clip.sourceStart + clip.duration}</duration></file></clipitem>`).join('');
    return items ? `        <track>${items}\n        </track>` : '';
  };
  const videoTracks = timeline.tracks.map((track) => serializeTrack(track, 'video')).filter(Boolean).join('\n');
  const audioTracks = timeline.tracks.map((track) => serializeTrack(track, 'audio')).filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5"><sequence id="sequence-1"><name>${xml(name)}</name><duration>${timeline.durationInFrames}</duration>${rate}<logginginfo><lognote>Clash revision ${xml(revisionId)}</lognote></logginginfo><media><video><format><samplecharacteristics>${rate}<width>${timeline.compositionWidth}</width><height>${timeline.compositionHeight}</height></samplecharacteristics></format>
${videoTracks}
      </video><audio>
${audioTracks}
      </audio></media></sequence></xmeml>`;
}

export function buildNleHandoff(input: {
  target: NleTarget;
  timelineName: string;
  revisionId: string;
  timeline: TimelineDsl;
}): NleHandoffDocument {
  const preflight = preflightNleHandoff(input.timeline, input.target);
  const unresolved = preflight.items.find((item) => !item.resolved);
  if (unresolved) throw new Error(`${unresolved.itemId} must be baked before opening this Timeline in an external editor.`);
  const { clips, assets } = collectClips(input.timeline);
  if (input.target === 'davinci-resolve') {
    return { target: input.target, extension: 'otio', assets, preflight, content: serializeOtio(input.timelineName, input.revisionId, input.timeline, clips) };
  }
  if (input.target === 'final-cut-pro') {
    return { target: input.target, extension: 'fcpxml', assets, preflight, content: serializeFcpxml(input.timelineName, input.revisionId, input.timeline, clips) };
  }
  return { target: input.target, extension: 'xml', assets, preflight, content: serializePremiereXml(input.timelineName, input.revisionId, input.timeline, clips) };
}
