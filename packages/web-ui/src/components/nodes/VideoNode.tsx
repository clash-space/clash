import { memo, useEffect, useMemo, useRef, useState } from 'react';
/* eslint-disable @next/next/no-img-element */
import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import SourceHandleMenu from './SourceHandleMenu';
import DraftPlaceholder from './DraftPlaceholder';
import { ArrowClockwise, FilmSlate, TextT } from '@phosphor-icons/react';
import { useMediaViewer } from '../MediaViewerContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { normalizeStatus, isActiveStatus, type AssetStatus } from '@clash/web-ui/lib/assetStatus';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { useAsset, invalidateAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { thumbnailCache } from '@clash/web-ui/lib/utils/thumbnailCache';
import { runtimeApiUrl } from '@clash/web-ui/lib/runtimeConfig';
import {
    calculateDimensionsFromAspectRatio,
    calculateScaledDimensions,
    resolveInitialMediaSize,
} from './assetNodeSizing';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { IconButton } from '../ui/icon-button';
import { Tooltip } from '../ui/tooltip';

const MEDIA_NODE_CONTROL_CLASS = 'nodrag nopan bg-black/50 text-white backdrop-blur-sm hover:bg-black/70 focus-visible:ring-white/80 focus-visible:ring-offset-black/20';

const VideoNode = ({ data, selected, id, width, height }: NodeProps<Node<Record<string, any>>>) => {
    const [label, setLabel] = useState(data.label || 'Video Node');
    const { openViewer } = useMediaViewer();
    const { setNodes } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();
    const [status, setStatus] = useState<AssetStatus>(normalizeStatus(data.status) || (data.assetId ? 'completed' : 'generating'));
    const nodeAssetId = data.assetId as string | undefined;
    const asset = useAsset(nodeAssetId);
    // R2 key from assets table (resolved via assetId). Legacy data.src fallback intentionally removed.
    const videoR2Key = asset?.srcR2Key;
    const [videoUrl, setVideoUrl] = useState<string | undefined>(videoR2Key);
    const [description, setDescription] = useState(data.description || '');
    const [localThumbnail, setLocalThumbnail] = useState<string | null>(thumbnailCache.get(videoUrl));
    const signedVideoUrl = useSignedUrl(videoUrl);
    // Poster: asset's persisted cover, signed. Undefined until server processes the cover.
    const posterUrl = useSignedUrl(asset?.coverR2Key ?? undefined);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const lastReadyUrlRef = useRef<string | undefined>(undefined);
    const pendingThumbnailCaptureRef = useRef(false);
    const videoUrlRef = useRef(videoUrl);

    // Keep ref in sync with state
    useEffect(() => {
        videoUrlRef.current = videoUrl;
    }, [videoUrl]);

    const aspectRatioDimensions = calculateDimensionsFromAspectRatio(data.aspectRatio);
    const measuredWidth = width;
    const measuredHeight = height;

    // Size = measuredSize (Loro) OR aspectRatio placeholder. See ImageNode /
    // assetNodeSizing.ts — asset.metadata only drives the reconciliation
    // effect below, never direct render-path sizing.
    const currentSize = useMemo(() => resolveInitialMediaSize({
        measuredWidth,
        measuredHeight,
        aspectRatioDimensions,
    }), [measuredWidth, measuredHeight, aspectRatioDimensions]);

    const nodeWidth = currentSize.width;
    const nodeHeight = currentSize.height;

    // Load from cache if src changes
    useEffect(() => {
        if (videoUrl) {
            const cached = thumbnailCache.get(videoUrl);
            if (cached) setLocalThumbnail(cached);
        }
    }, [videoUrl]);

    // Sync status and videoUrl from Loro data changes (resolved via assetId when present).
    useEffect(() => {
        setStatus((prev: AssetStatus) => {
            const next = normalizeStatus(data.status);
            return next !== prev ? next : prev;
        });
        setVideoUrl((prev: string | undefined) => (videoR2Key !== prev ? videoR2Key : prev));
        setDescription((prev: string) => ((data.description || '') !== prev ? (data.description || '') : prev));
    }, [data.status, videoR2Key, data.description]);

    useEffect(() => {
        if (!videoUrl) {
            setIsVideoReady(false);
            lastReadyUrlRef.current = undefined;
            return;
        }
        if (videoUrl !== lastReadyUrlRef.current) {
            setIsVideoReady(false);
        }
    }, [videoUrl]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !videoUrl) return;

        // Only set ready if we have data AND we're not waiting for a seek
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            // If we are currently seeking, wait for onSeeked
            if (video.seeking) return;

            // If the video is at 0s but is long enough to have a thumbnail at 1s,
            // we probably haven't performed the initial seek yet (or onLoadedMetadata hasn't run).
            // Don't show the video yet to avoid the "white frame 0" flash.
            const duration = video.duration || 0;
            if (duration >= 1.0 && video.currentTime < 0.1) {
                return;
            }

            setIsVideoReady(true);
            lastReadyUrlRef.current = videoUrl;
        }
    }, [videoUrl]);

    const captureThumbnail = (
        video: HTMLVideoElement,
        url: string | undefined,
        options: { overwrite?: boolean } = {},
    ) => {
        if (!url || !video.videoWidth) return;
        try {
            const canvas = document.createElement('canvas');
            const maxSize = 512;
            const ratio = video.videoWidth / video.videoHeight;
            const baseWidth = Math.min(maxSize, video.videoWidth || maxSize);
            canvas.width = baseWidth;
            canvas.height = Math.max(1, Math.round(baseWidth / ratio));
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let totalBrightness = 0;
            for (let i = 0; i < data.length; i += 40) {
                totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
            }
            const avgBrightness = totalBrightness / (data.length / 40);

            const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
            // IMPORTANT: Read directly from cache instead of using localThumbnail state
            // to avoid stale closure values. This prevents overwriting good cached thumbnails
            // with white/black frames from accidental seeks.
            const existingThumbnail = thumbnailCache.get(url);
            if ((options.overwrite || !existingThumbnail) && avgBrightness > 20) {
                thumbnailCache.set(url, thumbnail);
                setLocalThumbnail(thumbnail);

                // Persist as the asset's cover (one-shot, fire-and-forget).
                // Skip if the asset already has one — server is the source of truth.
                // NB: `data` here shadows the component prop with imageData.data — read assetId via the captured `nodeAssetId`.
                if (nodeAssetId && !asset?.coverR2Key) {
                    persistCover(canvas, nodeAssetId).catch((e) =>
                        console.warn('[VideoNode] cover persist failed', e),
                    );
                }
            }
        } catch (err) {
            console.warn('[VideoNode] Thumbnail capture failed:', err);
        }
    };

    const captureThumbnailAfterFrame = (video: HTMLVideoElement, overwrite = false) => {
        const doCapture = () => captureThumbnail(video, videoUrlRef.current, { overwrite });
        if ('requestVideoFrameCallback' in video) {
            // Use the modern API to wait for the next painted frame.
            (video as any).requestVideoFrameCallback(doCapture);
        } else {
            // Fallback: allow the seeked frame to render before drawing.
            setTimeout(doCapture, 100);
        }
    };

    const refreshThumbnail = () => {
        setLocalThumbnail(null);
        const video = videoRef.current;
        if (!video) return;

        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const maxSeek = Math.min(duration, 5);
        if (maxSeek <= 0) {
            captureThumbnailAfterFrame(video, true);
            return;
        }

        const targetTime = maxSeek > 0.1
            ? 0.1 + Math.random() * (maxSeek - 0.1)
            : maxSeek;

        const captureAfterSeek = () => captureThumbnailAfterFrame(video, true);
        video.addEventListener('seeked', captureAfterSeek, { once: true });
        if (Math.abs(video.currentTime - targetTime) < 0.01) {
            video.removeEventListener('seeked', captureAfterSeek);
            captureAfterSeek();
        } else {
            video.currentTime = targetTime;
        }
    };

    /** Upload the captured cover blob to R2 and PATCH the asset row.
     *  The asset table is the source of truth; useAsset picks up coverR2Key on next read. */
    const persistCover = async (canvas: HTMLCanvasElement, assetId: string): Promise<void> => {
        const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
        if (!blob) return;
        const file = new File([blob], `cover-${assetId}.jpg`, { type: 'image/jpeg' });
        const form = new FormData();
        form.append('file', file);
        form.append('type', 'cover');
        const upRes = await fetch(runtimeApiUrl('/upload'), { method: 'POST', body: form });
        if (!upRes.ok) throw new Error(`cover upload ${upRes.status}`);
        const { storageKey } = (await upRes.json()) as { storageKey: string };
        const patchRes = await fetch(runtimeApiUrl(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ coverR2Key: storageKey }),
        });
        if (!patchRes.ok) throw new Error(`cover patch ${patchRes.status}`);
        invalidateAsset(assetId);
    };

    const posterImage = localThumbnail || posterUrl;

    // Reconciliation — same pattern as ImageNode. asset.metadata is the
    // authoritative size; every time it's available compare against Loro's
    // measuredSize and repair any drift. Idempotent across clients.
    useEffect(() => {
        const assetW = asset?.metadata?.width;
        const assetH = asset?.metadata?.height;
        if (!assetW || !assetH) return;
        const target = calculateScaledDimensions(assetW, assetH);
        const mw = Number(measuredWidth);
        const mh = Number(measuredHeight);
        if (mw === target.width && mh === target.height) return;
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id !== id) return node;
                return {
                    ...node,
                    width: target.width,
                    height: target.height,
                    style: {
                        ...node.style,
                        width: target.width,
                        height: target.height,
                    },
                };
            })
        );
        if (loroSync?.connected) {
            loroSync.updateNode(id, { width: target.width, height: target.height });
        }
    }, [
        asset?.metadata?.width,
        asset?.metadata?.height,
        measuredWidth,
        measuredHeight,
        id,
        setNodes,
        loroSync,
    ]);

    // Loro sync handles state updates - no polling needed

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (videoUrl && (status === 'completed')) {
            openViewer('video', signedVideoUrl, label);
        }
    };

    return (
        <div
            className="group relative"
        >
            {/* Floating Title Input */}
            <div
                className="absolute -top-8 left-4 z-10"
                onDoubleClick={(e) => e.stopPropagation()}
            >
                <input
                    className="bg-transparent text-lg font-bold font-display text-slate-700 dark:text-slate-300 focus:text-slate-900 focus:outline-none"
                    value={label}
                    onChange={(evt) => {
                        const newLabel = evt.target.value;
                        setLabel(newLabel);
                        setNodes((nds) =>
                            nds.map((node) => {
                                if (node.id === id) {
                                    return {
                                        ...node,
                                        data: {
                                            ...node.data,
                                            label: newLabel,
                                        },
                                    };
                                }
                                return node;
                            })
                        );
                    }}
                />
            </div>

            {/* Main Card */}
            <Collapsible
                className={`group/description relative bg-warm-surface shadow-md rounded-matrix overflow-hidden transition-all duration-300 hover:shadow-lg ${selected ? 'ring-4 ring-brand ring-offset-2' : 'ring-1 ring-warm-border'
                    }`}
                style={{
                    width: nodeWidth,
                    height: nodeHeight,
                    minWidth: 240,
                    minHeight: 180,
                }}
                onDoubleClick={handleDoubleClick}
            >
                {status === 'draft' ? (
                    <DraftPlaceholder nodeId={id} modality="video" />
                ) : videoUrl || (status === 'completed' && data.previewUrl) ? (
                    // Same as ImageNode: prefer the resolved asset over a stale
                    // `status:'failed'` state (asset row + R2 blob are intact).
                    <div className="relative" style={{ width: '100%', height: '100%' }}>
                        <video
                            ref={videoRef}
                            // Bridge with data.previewUrl while useAsset(assetId)
                            // hasn't resolved yet — same reason as ImageNode.
                            src={signedVideoUrl || (data.previewUrl as string | undefined) || undefined}
                            poster={!isVideoReady && posterImage ? posterImage : undefined}
                            controls={false}
                            className="block pointer-events-none"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                            }}
                            crossOrigin="anonymous"
                            preload="metadata"
                            playsInline
                            onLoadedMetadata={(e) => {
                                const video = e.target as HTMLVideoElement;
                                const duration = video.duration || 0;

                                // Duration is owned by the asset row (server-probed at upload/generation).
                                // We intentionally do NOT write back video.duration to node data here.

                                // Trigger thumbnail generation if needed
                                if (!localThumbnail) {
                                    pendingThumbnailCaptureRef.current = true;
                                }

                                // Always seek to 1.0s if possible to match the thumbnail frame.
                                // This prevents the "white preview" issue where the video element
                                // displays the frame at 0s (often white/black) after loading,
                                // replacing the cached thumbnail which was captured at 1.0s.
                                if (duration >= 1.0) {
                                    video.currentTime = 1.0;
                                } else if (duration > 0) {
                                    // For very short videos, try to show something other than 0s if possible,
                                    // or just leave it. If we can't seek to 1.0, we probably didn't capture
                                    // a thumbnail at 1.0 either.
                                }

                                // Don't set isVideoReady(true) here - wait for onLoadedData/onCanPlay/onSeeked
                                // to ensure the frame is actually rendered. This prevents white flashes.
                            }}
                            onLoadedData={(e) => {
                                const video = e.target as HTMLVideoElement;
                                if (!video.seeking) {
                                    setIsVideoReady(true);
                                    lastReadyUrlRef.current = videoUrl;
                                }
                            }}
                            onCanPlay={(e) => {
                                const video = e.target as HTMLVideoElement;
                                if (!video.seeking) {
                                    setIsVideoReady(true);
                                    lastReadyUrlRef.current = videoUrl;
                                }
                            }}
                            onSeeked={(e) => {
                                const video = e.target as HTMLVideoElement;
                                setIsVideoReady(true);
                                lastReadyUrlRef.current = videoUrl;

                                // Only capture thumbnail at exactly 1.0 second (our explicit seek)
                                // This prevents capturing thumbnails from browser auto-seek or other operations
                                if (video.videoWidth > 0 && Math.abs(video.currentTime - 1.0) < 0.1 && pendingThumbnailCaptureRef.current) {
                                    pendingThumbnailCaptureRef.current = false;

                                    captureThumbnailAfterFrame(video);
                                }
                            }}
                        />

                        {/* Top Right Controls */}
                        <div className="absolute top-2 right-2 flex gap-1 z-10">
                            <Tooltip label="Toggle description">
                                <CollapsibleTrigger asChild>
                                    <IconButton
                                        label="Toggle description"
                                        icon={<TextT size={12} weight="bold" />}
                                        size="sm"
                                        shape="circle"
                                        className={`${MEDIA_NODE_CONTROL_CLASS} group-data-[state=open]/description:bg-black/80`}
                                    />
                                </CollapsibleTrigger>
                            </Tooltip>
                            <Tooltip label="Refresh thumbnail">
                                <IconButton
                                    label="Refresh thumbnail"
                                    icon={<ArrowClockwise className="h-4 w-4" weight="bold" />}
                                    size="sm"
                                    shape="circle"
                                    className={MEDIA_NODE_CONTROL_CLASS}
                                    onClick={refreshThumbnail}
                                />
                            </Tooltip>
                            <div className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
                                Video
                            </div>
                        </div>

                        {/* Play overlay hint */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 bg-black/10 pointer-events-none">
                            <div className="rounded-full bg-white/20 p-2 backdrop-blur-sm">
                                <FilmSlate size={24} className="text-white" weight="fill" />
                            </div>
                        </div>
                        {!isVideoReady && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/25 backdrop-blur-[2px]">
                                {posterImage && (
                                    <img
                                        src={posterImage}
                                        alt=""
                                        className="absolute inset-0 h-full w-full object-cover"
                                    />
                                )}
                                <div className="relative z-10 flex flex-col items-center gap-2">
                                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                                    <span className="text-xs font-medium text-white animate-pulse">Loading...</span>
                                </div>
                            </div>
                        )}
                    </div>
                ) : status === 'uploading' && data.previewUrl ? (
                    <div className="relative" style={{ width: '100%', height: '100%' }}>
                        <video
                            src={data.previewUrl as string}
                            controls={false}
                            className="block pointer-events-none opacity-70"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                            }}
                            preload="metadata"
                            playsInline
                            onLoadedMetadata={(e) => {
                                const video = e.target as HTMLVideoElement;
                                if (!localThumbnail) {
                                    pendingThumbnailCaptureRef.current = true;
                                    video.currentTime = 1.0;
                                }
                            }}
                            onSeeked={(e) => {
                                const video = e.target as HTMLVideoElement;
                                setIsVideoReady(true);
                                lastReadyUrlRef.current = videoUrl;

                                // Only capture thumbnail at exactly 1.0 second (our explicit seek)
                                // This prevents capturing thumbnails from browser auto-seek or other operations
                                if (video.videoWidth > 0 && Math.abs(video.currentTime - 1.0) < 0.1 && pendingThumbnailCaptureRef.current) {
                                    pendingThumbnailCaptureRef.current = false;

                                    captureThumbnailAfterFrame(video);
                                }
                            }}
                        />
                        {/* Loading Overlay */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
                            <div className="flex flex-col items-center gap-2">
                                <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                                <span className="text-xs font-medium text-white animate-pulse">Uploading...</span>
                            </div>
                        </div>
                    </div>
                ) : isActiveStatus(status) ? (
                    <div className="relative flex items-center justify-center bg-warm-muted text-slate-700 dark:text-slate-300" style={{ width: '100%', height: '100%' }}>
                        {posterUrl && (
                            <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
                        )}
                        <div className="relative z-10 flex flex-col items-center gap-3">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-warm-border border-t-video" />
                            <span className="text-xs font-medium animate-pulse text-slate-700 dark:text-slate-300 bg-warm-surface/70 px-2 py-0.5 rounded-lg backdrop-blur-sm">Generating Video...</span>
                        </div>
                    </div>
                ) : status === 'failed' ? (
                    <div className="flex items-center justify-center bg-red-50 text-red-400" style={{ width: '100%', height: '100%' }}>
                        <div className="flex flex-col items-center gap-2">
                            <FilmSlate size={32} weight="duotone" />
                            <span className="text-xs font-medium">Generation Failed</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center bg-warm-muted text-slate-700 dark:text-slate-300" style={{ width: '100%', height: '100%' }}>
                        <div className="flex flex-col items-center gap-2">
                            <FilmSlate size={32} />
                            <span className="text-xs">No Video</span>
                        </div>
                    </div>
                )}

                {/* Description Box */}
                <CollapsibleContent
                    className="absolute left-0 right-0 bottom-0 z-20 border-t border-warm-border bg-warm-surface/95 p-3 backdrop-blur"
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <textarea
                        className="w-full h-24 resize-none bg-transparent text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
                        value={description || ((status === 'completed') ? 'Generating description...' : 'No description available.')}
                        readOnly
                    />
                </CollapsibleContent>
            </Collapsible>

            {/* Asset nodes only have output (source) */}
            <Handle
                type="target"
                position={Position.Left}
                isConnectable={false}
                style={{ top: '50%', left: '-8px' }}
                className="!h-4 !w-4 !border-4 !border-warm-surface !bg-stone-400 transition-all hover:!bg-brand hover:scale-125 shadow-sm !opacity-0 !pointer-events-none"
            />
            <SourceHandleMenu nodeId={id} sourceType="video" />
        </div>
    );
};

export default memo(VideoNode);
