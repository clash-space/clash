import { memo, useEffect, useRef, useState } from 'react';
/* eslint-disable @next/next/no-img-element */
import { Handle, Position, NodeProps, useReactFlow, useNodes } from 'reactflow';
import SourceHandleMenu from './SourceHandleMenu';
import { FilmSlate, TextT } from '@phosphor-icons/react';
import { useMediaViewer } from '../MediaViewerContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { normalizeStatus, isActiveStatus, type AssetStatus } from '../../../lib/assetStatus';
import { resolveAssetUrl } from '../../../lib/utils/assets';
import { thumbnailCache } from '../../../lib/utils/thumbnailCache';
import {
    calculateDimensionsFromAspectRatio,
    calculateScaledDimensions,
    hasValidMeasuredSize,
    resolveInitialMediaSize,
} from './assetNodeSizing';

const VideoNode = ({ data, selected, id }: NodeProps) => {
    const [label, setLabel] = useState(data.label || 'Video Node');
    const { openViewer } = useMediaViewer();
    const { setNodes } = useReactFlow();
    const nodes = useNodes();
    const loroSync = useOptionalLoroSyncContext();
    const [status, setStatus] = useState<AssetStatus>(normalizeStatus(data.status) || (data.src ? 'completed' : 'generating'));
    const [videoUrl, setVideoUrl] = useState<string | undefined>(data.src);
    const [description, setDescription] = useState(data.description || '');
    const [localThumbnail, setLocalThumbnail] = useState<string | null>(thumbnailCache.get(videoUrl));
    const posterUrl = data.referenceImageUrls?.[0] ? resolveAssetUrl(data.referenceImageUrls[0]) : undefined;
    const [isVideoReady, setIsVideoReady] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const lastReadyUrlRef = useRef<string | undefined>(undefined);
    const didInitSizeRef = useRef(false);
    const pendingThumbnailCaptureRef = useRef(false);
    const videoUrlRef = useRef(videoUrl);

    // Keep ref in sync with state
    useEffect(() => {
        videoUrlRef.current = videoUrl;
    }, [videoUrl]);

    // Get current node dimensions
    const currentNode = nodes.find((n) => n.id === id);

    // Calculate dimensions from aspect ratio if available (for generating state)
    const aspectRatioDimensions = calculateDimensionsFromAspectRatio(data.aspectRatio);

    // If natural dimensions are provided (from upload), use those for initial sizing
    const naturalDimensions = data.naturalWidth && data.naturalHeight
        ? calculateScaledDimensions(data.naturalWidth, data.naturalHeight)
        : null;

    const hasPreview = Boolean(videoUrl);
    const measuredWidth = currentNode?.width ?? currentNode?.style?.width;
    const measuredHeight = currentNode?.height ?? currentNode?.style?.height;

    // Use useState for stable initial size calculation
    const [initialSize] = useState<{ width: number; height: number }>(() => {
        // Log debug info only on initial calculation
        console.log('[VideoNode] Calculating initial size:', {
            id,
            naturalWidth: data.naturalWidth,
            naturalHeight: data.naturalHeight,
            naturalDimensions,
            originalSrc: data.src,
            videoUrl,
        });
        
        return resolveInitialMediaSize({
            status,
            hasPreview,
            measuredWidth,
            measuredHeight,
            naturalDimensions,
            aspectRatioDimensions,
        });
    });

    const nodeWidth = initialSize.width;
    const nodeHeight = initialSize.height;

    // Load from cache if src changes
    useEffect(() => {
        if (videoUrl) {
            const cached = thumbnailCache.get(videoUrl);
            if (cached) setLocalThumbnail(cached);
        }
    }, [videoUrl]);
    const [showDescription, setShowDescription] = useState(false);

    // Sync status and videoUrl from Loro data changes
    useEffect(() => {
        setStatus((prev: AssetStatus) => {
            const next = normalizeStatus(data.status);
            return next !== prev ? next : prev;
        });
        setVideoUrl((prev: string | undefined) => (data.src !== prev ? data.src : prev));
        setDescription((prev: string) => ((data.description || '') !== prev ? (data.description || '') : prev));
    }, [data.status, data.src, data.description]);

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

    const captureThumbnail = (video: HTMLVideoElement, url: string | undefined) => {
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
            if (!existingThumbnail && avgBrightness > 20) {
                thumbnailCache.set(url, thumbnail);
                setLocalThumbnail(thumbnail);
            }
        } catch (err) {
            console.warn('[VideoNode] Thumbnail capture failed:', err);
        }
    };

    const posterImage = localThumbnail || posterUrl;

    useEffect(() => {
        if (didInitSizeRef.current) return;
        didInitSizeRef.current = true;
        if (!hasValidMeasuredSize(measuredWidth, measuredHeight)) {
            const nextWidth = nodeWidth;
            const nextHeight = nodeHeight;
            setNodes((nds) =>
                nds.map((node) => {
                    if (node.id !== id) return node;
                    return {
                        ...node,
                        width: nextWidth,
                        height: nextHeight,
                        style: {
                            ...node.style,
                            width: nextWidth,
                            height: nextHeight,
                        },
                    };
                })
            );

            if (loroSync?.connected) {
                loroSync.updateNode(id, { width: nextWidth, height: nextHeight });
            }
        }
    }, [id, loroSync, measuredHeight, measuredWidth, nodeHeight, nodeWidth, setNodes]);

    // Loro sync handles state updates - no polling needed

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (videoUrl && (status === 'completed')) {
            openViewer('video', resolveAssetUrl(videoUrl), label);
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
                    className="bg-transparent text-lg font-bold font-display text-slate-500 focus:text-slate-900 focus:outline-none"
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
            <div
                className={`relative bg-white shadow-md rounded-matrix overflow-hidden transition-all duration-300 hover:shadow-lg ${selected ? 'ring-4 ring-red-500 ring-offset-2' : 'ring-1 ring-slate-200'
                    }`}
                style={{
                    width: nodeWidth,
                    height: nodeHeight,
                    minWidth: 240,
                    minHeight: 180,
                }}
                onDoubleClick={handleDoubleClick}
            >
                {(status === 'completed') && videoUrl ? (
                    <div className="relative" style={{ width: '100%', height: '100%' }}>
                        <video
                            ref={videoRef}
                            src={resolveAssetUrl(videoUrl)}
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

                                // Always update duration in data (even if dimensions haven't changed)
                                if (duration > 0 && data.duration !== duration) {
                                    setNodes((nds) =>
                                        nds.map((node) => {
                                            if (node.id !== id) return node;
                                            return {
                                                ...node,
                                                data: {
                                                    ...node.data,
                                                    duration: duration,
                                                },
                                            };
                                        })
                                    );

                                    if (loroSync?.connected) {
                                        loroSync.updateNode(id, { duration });
                                    }
                                }

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

                                    // Wait for the frame to actually render before capturing
                                    // This fixes the issue where cached videos load too fast
                                    // and the seeked event fires before the frame is rendered
                                    const doCapture = () => captureThumbnail(video, videoUrlRef.current);

                                    if ('requestVideoFrameCallback' in video) {
                                        // Use the modern API to wait for the next painted frame
                                        (video as any).requestVideoFrameCallback(doCapture);
                                    } else {
                                        // Fallback: use setTimeout to allow the frame to render
                                        setTimeout(doCapture, 100);
                                    }
                                }
                            }}
                        />

                        {/* Top Right Controls */}
                        <div className="absolute top-2 right-2 flex gap-1 z-10">
                            <button
                                className="rounded-full bg-black/50 p-1 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDescription(!showDescription);
                                }}
                            >
                                <TextT size={12} weight="bold" />
                            </button>
                            <button
                                className="rounded-full bg-black/50 p-1 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setLocalThumbnail(null);
                                    // The video element is already rendered, we need to trigger a seek to re-capture
                                    const video = document.querySelector(`video[src*="${videoUrl}"]`) as HTMLVideoElement;
                                    if (video) video.currentTime = Math.random() * Math.min(video.duration, 5);
                                }}
                                title="Refresh Thumbnail"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                            </button>
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
                ) : status === 'uploading' && videoUrl ? (
                    <div className="relative" style={{ width: '100%', height: '100%' }}>
                        <video
                            src={resolveAssetUrl(videoUrl)}
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

                                    // Wait for the frame to actually render before capturing
                                    // This fixes the issue where cached videos load too fast
                                    // and the seeked event fires before the frame is rendered
                                    const doCapture = () => captureThumbnail(video, videoUrlRef.current);

                                    if ('requestVideoFrameCallback' in video) {
                                        // Use the modern API to wait for the next painted frame
                                        (video as any).requestVideoFrameCallback(doCapture);
                                    } else {
                                        // Fallback: use setTimeout to allow the frame to render
                                        setTimeout(doCapture, 100);
                                    }
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
                    <div className="relative flex items-center justify-center bg-slate-50 text-slate-400" style={{ width: '100%', height: '100%' }}>
                        {posterUrl && (
                            <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
                        )}
                        <div className="relative z-10 flex flex-col items-center gap-3">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-500" />
                            <span className="text-xs font-medium animate-pulse text-slate-600 bg-white/50 px-2 py-0.5 rounded-full backdrop-blur-sm">Generating Video...</span>
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
                    <div className="flex items-center justify-center bg-slate-100 text-slate-400" style={{ width: '100%', height: '100%' }}>
                        <div className="flex flex-col items-center gap-2">
                            <FilmSlate size={32} />
                            <span className="text-xs">No Video</span>
                        </div>
                    </div>
                )}

                {/* Description Box */}
                {showDescription && (
                    <div
                        className="absolute left-0 right-0 bottom-0 z-20 border-t border-slate-100 bg-slate-50/95 p-3 backdrop-blur"
                        onDoubleClick={(e) => e.stopPropagation()}
                    >
                        <textarea
                            className="w-full h-24 resize-none bg-transparent text-xs text-slate-600 focus:outline-none"
                            value={description || ((status === 'completed') ? 'Generating description...' : 'No description available.')}
                            readOnly
                        />
                    </div>
                )}
            </div>

            {/* Asset nodes only have output (source) */}
            <Handle
                type="target"
                position={Position.Left}
                isConnectable={false}
                style={{ top: '50%', left: '-8px' }}
                className="!h-4 !w-4 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-red-500 hover:scale-125 shadow-sm !opacity-0 !pointer-events-none"
            />
            <SourceHandleMenu nodeId={id} />
        </div>
    );
};

export default memo(VideoNode);
