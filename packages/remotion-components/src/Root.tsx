import React from 'react';
import { Composition, registerRoot, getInputProps } from 'remotion';
import { VideoComposition } from './VideoComposition';

/**
 * Input props for Remotion CLI rendering
 * These are passed via --props when rendering
 */
export interface RemotionInputProps {
  tracks: any[];
  compositionWidth?: number;
  compositionHeight?: number;
  fps?: number;
  durationInFrames?: number;
}

/**
 * Remotion Root Component
 * Entry point for Remotion CLI - registers the VideoComposition
 *
 * Usage:
 *   npx remotion render src/Root.tsx VideoComposition --props '{"tracks": [...]}' --output video.mp4
 *   npx remotion bundle src/Root.tsx --outdir=./dist
 */
export const RemotionRoot: React.FC<RemotionInputProps> = (props) => {
  // Merge props from argument (if any) and getInputProps() (CLI/Studio)
  const inputProps = {
    ...getInputProps(),
    ...props,
  } as RemotionInputProps;

  // Debug log to see what props are actually received
  console.log('[RemotionRoot] Received props:', JSON.stringify(inputProps, null, 2));

  // Extract composition settings from input props, with defaults
  const {
    compositionWidth = 1920,
    compositionHeight = 1080,
    fps = 30,
    durationInFrames = 300,
    tracks = [],
  } = inputProps || {};

  console.log(`[RemotionRoot] Config: ${compositionWidth}x${compositionHeight} @ ${fps}fps, duration: ${durationInFrames}`);

  // Debug: Print each track and item to verify naturalWidth/naturalHeight are present
  tracks.forEach((track: any, trackIdx: number) => {
    console.log(`[RemotionRoot] Track ${trackIdx}: id=${track.id}, items=${track.items?.length || 0}`);
    (track.items || []).forEach((item: any, itemIdx: number) => {
      console.log(`[RemotionRoot]   Item ${itemIdx}: id=${item.id}, type=${item.type}, assetId=${item.assetId || 'none'}, src=${item.src?.slice(0, 50) || 'none'}, naturalWidth=${item.naturalWidth || 'MISSING'}, naturalHeight=${item.naturalHeight || 'MISSING'}, aspectRatio=${item.aspectRatio || 'none'}`);
    });
  });

  return (
    <>
      <Composition
        id="VideoComposition"
        component={VideoComposition}
        width={compositionWidth}
        height={compositionHeight}
        fps={fps}
        durationInFrames={durationInFrames}
        defaultProps={{
          tracks,
          selectedItemId: null,
          selectionBoxRef: undefined,
          itemsDomMapRef: undefined,
        }}
      />
    </>
  );
};

// Register the root for Remotion CLI
registerRoot(RemotionRoot);
