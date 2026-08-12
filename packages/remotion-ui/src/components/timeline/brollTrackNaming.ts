import type { Track } from '@clash/remotion-core';

type BrollTrackIdentity = Pick<Track, 'id' | 'role'>;

export function getNextBrollTrackName(
  tracks: readonly BrollTrackIdentity[],
  primaryTrackId?: string | null,
): string {
  const additionalBrollCount = tracks.filter(
    (track) => track.id !== primaryTrackId && track.role === 'b-roll',
  ).length;
  const nextNumber = additionalBrollCount + 1;
  return nextNumber === 1 ? 'B-roll' : `B-roll ${nextNumber}`;
}

export function createBrollTrack({
  id,
  tracks,
  primaryTrackId,
}: {
  id: string;
  tracks: readonly BrollTrackIdentity[];
  primaryTrackId?: string | null;
}): Track {
  return {
    id,
    name: getNextBrollTrackName(tracks, primaryTrackId),
    role: 'b-roll',
    category: 'visual',
    items: [],
  };
}
