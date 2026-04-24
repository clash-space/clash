import React from 'react';
import {
  EditorProvider,
  getEditorAssetKey,
  normalizeEditorAsset,
  useEditor,
  useEditorDispatch,
  useEditorStaticState,
  type EditorState,
  type EditorAssetInput,
} from '@master-clash/remotion-core';
import { CanvasPreview } from './CanvasPreview';
import { Timeline } from './Timeline';
import { AssetPanel } from './AssetPanel';
import { PropertiesPanel } from './PropertiesPanel';

const AssetInitializer = ({ assets }: { assets: EditorAssetInput[] }) => {
  const dispatch = useEditorDispatch();
  const { assets: editorAssets } = useEditorStaticState();
  const addedAssetsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!assets || assets.length === 0) return;

    // We removed the strict initializedRef check to allow prop updates to add new assets.
    // The deduplication logic below ensures we don't add the same asset twice.

    assets.forEach(asset => {
      const assetKey = getEditorAssetKey(asset);

      // Check if already added in this session via this component
      if (addedAssetsRef.current.has(assetKey)) {
        return;
      }

      // Check if already in global state
      const existingById = editorAssets.find((a) => a.id === asset.id);
      const existingBySrc = editorAssets.find((a) => a.src === (asset.src || asset.url));
      const existingBySourceNode = editorAssets.find((a) =>
        asset.sourceNodeId && a.sourceNodeId === asset.sourceNodeId
      );

      // Strict check: if asset exists in state, skip
      if (existingById || existingBySrc || existingBySourceNode) {
        // Add to local ref so we don't check again
        addedAssetsRef.current.add(assetKey);
        return;
      }

      addedAssetsRef.current.add(assetKey);
      dispatch({
        type: 'ADD_ASSET',
        payload: normalizeEditorAsset(asset),
      });
    });
  }, [assets, editorAssets, dispatch]);
  return null;
};

/**
 * Syncs editor state to an external ref without triggering re-renders.
 * Used for "save on close" pattern - parent reads ref when editor closes.
 */
const StateSyncer = ({ stateRef }: { stateRef: React.MutableRefObject<EditorState | null> }) => {
  const { state } = useEditor();
  // Update ref on every render, no useEffect needed - this is intentional
  stateRef.current = state;
  return null;
};

type EditorProps = {
  initialAssets?: EditorAssetInput[];
  initialState?: Partial<EditorState>;
  /** Ref to read final state on close - avoids onStateChange overhead during playback */
  stateRef?: React.MutableRefObject<EditorState | null>;
  /** @deprecated Use stateRef for better performance */
  onStateChange?: (state: EditorState) => void;
  onBack?: () => void;
  backLabel?: string;
  onAssetUpload?: (file: File, type: 'video' | 'image' | 'audio') => void;
  availableAssets?: EditorAssetInput[];
  onAssetPicked?: (asset: EditorAssetInput) => void;
  /** Unique key to force remount when opening different editors */
  editorKey?: string;
  /** Export video callback */
  onExport?: () => Promise<void>;
};

export const Editor: React.FC<EditorProps> = ({
  initialAssets,
  initialState,
  stateRef,
  onStateChange,
  onBack,
  backLabel,
  onAssetUpload,
  availableAssets,
  onAssetPicked,
  editorKey,
  onExport,
}) => {
  // Seed assets into initialState synchronously so the first render already
  // has them in state.assets. Without this, `CanvasPreview` → `VideoComposition`
  // renders once with an empty assets map; items whose `src` was stripped on
  // persist (see timelineDsl.stripSrcFromTracks) resolve to `src=""`, Remotion's
  // <Img>/<OffthreadVideo> throw "No src prop", the Player's ErrorBoundary
  // latches on the error UI and never recovers even once AssetInitializer's
  // effect lands the assets on a subsequent pass.
  const seededAssets = React.useMemo(
    () => (initialAssets ?? []).map((asset) => normalizeEditorAsset(asset)),
    [initialAssets],
  );
  const seededInitialState = { ...initialState, assets: seededAssets };

  return (
    <EditorProvider initialState={seededInitialState} onStateChange={onStateChange} key={editorKey}>
      {stateRef && <StateSyncer stateRef={stateRef} />}
      <AssetInitializer assets={initialAssets || []} />
      <div className="w-full h-full flex flex-col bg-white font-sans text-slate-900">
        {/* Header removed as requested */}

        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Assets */}
          <aside className="shrink-0 border-r border-slate-200 bg-slate-50/50" style={{ width: '22%', minWidth: 220, maxWidth: 360 }}>
            <AssetPanel
              onBack={onBack}
              backLabel={backLabel}
              onAssetUpload={onAssetUpload}
              availableAssets={availableAssets}
              onAssetPicked={onAssetPicked}
              onExport={onExport}
            />
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 flex flex-col min-w-0 bg-slate-50/30">
            {/* Top Row - Preview and Properties */}
            <div className="flex-1 flex" style={{ minHeight: 0 }}>
              {/* Preview Area */}
              <div
                className="flex-1 p-4 flex items-center justify-center bg-slate-100/50"
                style={{ minHeight: 0 }}
              >
                <div className="w-full h-full rounded-lg overflow-hidden bg-white shadow-lg ring-1 ring-slate-900/5">
                  <CanvasPreview />
                </div>
              </div>
              <aside className="w-[320px] shrink-0 border-l border-slate-200 bg-white">
                <PropertiesPanel />
              </aside>
            </div>

            {/* Timeline Area - Full Width with fixed height */}
            <div
              className="border-t border-slate-200 bg-white relative"
              style={{ height: 300, flexShrink: 0 }}
            >
              <Timeline />
            </div>
          </main>
        </div>
      </div>
    </EditorProvider>
  );
};
