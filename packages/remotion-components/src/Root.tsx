import React from 'react';
import { Composition, registerRoot, getInputProps } from 'remotion';
import { VideoComposition } from './VideoComposition';
import { EffectSdkDemo } from './effect-demo/EffectSdkDemo';
import { buildEffectDemoPlan } from './effect-demo/effectDemoPlan';
import { TimelineLibraryDemo } from './library-demo/TimelineLibraryDemo';
import { buildTimelineLibraryDemoPlan } from './library-demo/timelineLibraryDemoPlan';

/**
 * Input props for Remotion CLI rendering
 * These are passed via --props when rendering
 */
export interface RemotionInputProps {
  tracks?: any[];
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

  // Extract composition settings from input props, with defaults
  const {
    compositionWidth = 1920,
    compositionHeight = 1080,
    fps = 30,
    durationInFrames = 300,
    tracks = [],
  } = inputProps || {};

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
      <Composition
        id="EffectSdkDemo"
        component={EffectSdkDemo}
        width={1280}
        height={720}
        fps={30}
        durationInFrames={buildEffectDemoPlan(30).totalFrames}
      />
      <Composition
        id="TimelineLibraryDemo"
        component={TimelineLibraryDemo}
        width={1280}
        height={720}
        fps={30}
        durationInFrames={buildTimelineLibraryDemoPlan(30).totalFrames}
      />
    </>
  );
};

// Register the root for Remotion CLI
registerRoot(RemotionRoot);
