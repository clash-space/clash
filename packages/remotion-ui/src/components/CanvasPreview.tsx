import React, { useMemo } from "react";
import {
  useEditorDispatch,
  useEditorPlayback,
  useEditorPlaybackRefs,
  useEditorStaticState,
} from "@master-clash/remotion-core";
import { InteractiveCanvas } from "./InteractiveCanvasV2";

export const CanvasPreview: React.FC = React.memo(() => {
  const dispatch = useEditorDispatch();
  const { tracks, assets, selectedItemId, compositionWidth, compositionHeight, fps } = useEditorStaticState();
  const { currentFrame, playing } = useEditorPlayback();
  const { currentFrameRef, playingRef } = useEditorPlaybackRefs();

  // Calculate duration from timeline (max end frame of all items)
  const timelineDuration = useMemo(() => {
    let maxEnd = 0;
    for (const track of tracks) {
      for (const item of track.items) {
        const end = item.from + item.durationInFrames;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd > 0 ? maxEnd : 300; // 300 frames = 10 seconds at 30fps as fallback
  }, [tracks]);

  // Create allNodesMap from assets for resolving timeline references.
  // sourceNodeId references the canvas node; assetId references the D1 asset row.
  // Map all stable identities for compatibility with old and new DSL.
  const allNodesMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const asset of assets) {
      const nodeData = {
        type: asset.type,
        data: {
          src: asset.src,
          naturalWidth: asset.width,
          naturalHeight: asset.height,
        },
      };
      map.set(asset.id, nodeData);
      if (asset.sourceNodeId && asset.sourceNodeId !== asset.id) {
        map.set(asset.sourceNodeId, nodeData);
      }
      if (asset.backingAssetId) {
        map.set(asset.backingAssetId, nodeData);
      }
    }
    return map;
  }, [assets]);

  return (
    <div style={styles.container}>
      {/* Canvas Area with InteractiveCanvas */}
      <div style={styles.canvasWrapper}>
        <InteractiveCanvas
          key="interactive-canvas"
          tracks={tracks}
          allNodesMap={allNodesMap}
          selectedItemId={selectedItemId}
          currentFrame={currentFrame}
          compositionWidth={compositionWidth}
          compositionHeight={compositionHeight}
          fps={fps}
          durationInFrames={timelineDuration}
          onUpdateItem={(trackId, itemId, updates) => {
            dispatch({
              type: "UPDATE_ITEM",
              payload: { trackId, itemId, updates },
            });
          }}
          onSelectItem={(itemId) => {
            dispatch({
              type: "SELECT_ITEM",
              payload: itemId,
            });
          }}
          playing={playing}
          onPlayingChange={(playing) => {
            if (playingRef.current !== playing) {
              dispatch({
                type: "SET_PLAYING",
                payload: playing,
              });
            }
          }}
          onFrameUpdate={(frame) => {
            const roundedFrame = Math.round(frame);
            if (roundedFrame !== currentFrameRef.current) {
              dispatch({
                type: "SET_CURRENT_FRAME",
                payload: roundedFrame,
              });
            }
          }}
          onSeek={(frame) => {
            if (frame !== currentFrameRef.current) {
              dispatch({
                type: "SET_CURRENT_FRAME",
                payload: frame,
              });
            }
          }}
        />
      </div>
    </div>
  );
});

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    backgroundColor: "transparent",
  },
  canvasWrapper: {
    flex: 1,
    backgroundColor: "transparent",
    minWidth: 0,
    minHeight: 0,
  },
};
