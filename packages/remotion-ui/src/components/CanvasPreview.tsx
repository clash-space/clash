import React, { useMemo } from "react";
import { useEditor } from "@master-clash/remotion-core";
import { InteractiveCanvas } from "./InteractiveCanvasV2";

export const CanvasPreview: React.FC = React.memo(() => {
  const { state, dispatch } = useEditor();

  // Calculate duration from timeline (max end frame of all items)
  const timelineDuration = useMemo(() => {
    let maxEnd = 0;
    for (const track of state.tracks) {
      for (const item of track.items) {
        const end = item.from + item.durationInFrames;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd > 0 ? maxEnd : 300; // 300 frames = 10 seconds at 30fps as fallback
  }, [state.tracks]);

  // Create allNodesMap from assets for resolving assetId references in VideoComposition
  // Timeline items use assetId which references the canvas node ID (sourceNodeId)
  // We need to map BOTH asset.id AND asset.sourceNodeId to support both cases
  const allNodesMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const asset of state.assets) {
      const nodeData = {
        type: asset.type,
        data: {
          src: asset.src,
          naturalWidth: asset.width,
          naturalHeight: asset.height,
        },
      };
      // Map by asset.id (internal editor ID)
      map.set(asset.id, nodeData);
      // Also map by sourceNodeId (canvas node ID) if different
      // This is the ID that timeline items reference via assetId
      if (asset.sourceNodeId && asset.sourceNodeId !== asset.id) {
        map.set(asset.sourceNodeId, nodeData);
      }
    }
    return map;
  }, [state.assets]);

  return (
    <div style={styles.container}>
      {/* Canvas Area with InteractiveCanvas */}
      <div style={styles.canvasWrapper}>
        <InteractiveCanvas
          key="interactive-canvas"
          tracks={state.tracks}
          allNodesMap={allNodesMap}
          selectedItemId={state.selectedItemId}
          currentFrame={state.currentFrame}
          compositionWidth={state.compositionWidth}
          compositionHeight={state.compositionHeight}
          fps={state.fps}
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
          playing={state.playing}
          onPlayingChange={(playing) => {
            dispatch({
              type: "SET_PLAYING",
              payload: playing,
            });
          }}
          onFrameUpdate={(frame) => {
            dispatch({
              type: "SET_CURRENT_FRAME",
              payload: Math.round(frame),
            });
          }}
          onSeek={(frame) => {
            dispatch({
              type: "SET_CURRENT_FRAME",
              payload: frame,
            });
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
    backgroundColor: "#1a1a1a",
  },
  canvasWrapper: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    minWidth: 0,
    minHeight: 0,
  },
};
