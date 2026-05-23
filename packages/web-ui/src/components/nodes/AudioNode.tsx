import { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, Node } from '@xyflow/react';
import SourceHandleMenu from './SourceHandleMenu';
import DraftPlaceholder from './DraftPlaceholder';
import { Play, Pause, X, SpeakerHigh, SkipBack, SkipForward, Spinner } from '@phosphor-icons/react';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { useAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { normalizeStatus, isActiveStatus, type AssetStatus } from '@clash/web-ui/lib/assetStatus';

const WAVEFORM_BARS = 128;
const SKIP_SECONDS = 10;

// In-memory cache so the same audio doesn't re-decode on each modal open.
// Keyed by signed URL's path (the R2 key) — the signature changes but the
// underlying bytes don't.
const waveformCache = new Map<string, { peaks: number[]; duration: number }>();
function cacheKey(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Downsample decoded mono/stereo PCM to N normalized peaks in [0, 1]. */
function computePeaks(audioBuffer: AudioBuffer, bars: number): number[] {
    const channelData: Float32Array[] = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
        channelData.push(audioBuffer.getChannelData(c));
    }
    const totalSamples = audioBuffer.length;
    const samplesPerBar = Math.max(1, Math.floor(totalSamples / bars));
    const peaks: number[] = new Array(bars).fill(0);
    let max = 0;

    for (let i = 0; i < bars; i += 1) {
        const start = i * samplesPerBar;
        const end = Math.min(start + samplesPerBar, totalSamples);
        let peak = 0;
        for (let j = start; j < end; j += 1) {
            let sample = 0;
            for (const ch of channelData) sample = Math.max(sample, Math.abs(ch[j] ?? 0));
            if (sample > peak) peak = sample;
        }
        peaks[i] = peak;
        if (peak > max) max = peak;
    }
    if (max > 0) {
        for (let i = 0; i < bars; i += 1) peaks[i] = peaks[i] / max;
    }
    return peaks;
}

const AudioNode = ({ data, selected, id }: NodeProps<Node<Record<string, any>>>) => {
    const [label, setLabel] = useState(data.label || 'Audio Node');
    const asset = useAsset(data.assetId);
    const audioR2Key = asset?.srcR2Key;
    const [status, setStatus] = useState<AssetStatus>(
        normalizeStatus(data.status) || (data.assetId ? 'completed' : 'generating'),
    );
    const [audioUrl, setAudioUrl] = useState<string | undefined>(audioR2Key);
    const signedAudioUrl = useSignedUrl(audioUrl);

    // Prefer server-probed metadata when present; client-side decode is only
    // the fallback when render-server couldn't produce duration / waveform.
    const metaDurationMs = asset?.metadata?.durationMs;
    const metaWaveform = asset?.metadata?.waveform;

    const [showModal, setShowModal] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(() =>
        typeof metaDurationMs === 'number' && metaDurationMs > 0 ? metaDurationMs / 1000 : 0,
    );
    const [peaks, setPeaks] = useState<number[] | undefined>(() =>
        Array.isArray(metaWaveform) && metaWaveform.length > 0 ? metaWaveform : undefined,
    );
    const [decoding, setDecoding] = useState(false);

    const audioRef = useRef<HTMLAudioElement>(null);
    const waveformRef = useRef<HTMLDivElement>(null);

    // Sync status + audioUrl from Loro changes.
    useEffect(() => {
        setStatus((prev) => {
            const next = normalizeStatus(data.status);
            return next !== prev ? next : prev;
        });
        setAudioUrl((prev) => (audioR2Key !== prev ? audioR2Key : prev));
    }, [data.status, audioR2Key]);

    // Reset / re-seed state when the source or its server-side metadata changes.
    useEffect(() => {
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(
            typeof metaDurationMs === 'number' && metaDurationMs > 0 ? metaDurationMs / 1000 : 0,
        );
        setPeaks(
            Array.isArray(metaWaveform) && metaWaveform.length > 0 ? metaWaveform : undefined,
        );
    }, [audioR2Key, metaDurationMs, metaWaveform]);

    // Client-side decode fallback: only runs when the server didn't produce
    // both duration and waveform. Cached across opens (same session) via
    // `waveformCache`.
    useEffect(() => {
        if (!showModal || !signedAudioUrl) return;
        const hasDuration = duration > 0;
        const hasPeaks = !!peaks && peaks.length > 0;
        if (hasDuration && hasPeaks) return;
        const cached = waveformCache.get(cacheKey(signedAudioUrl));
        if (cached) {
            if (!hasPeaks) setPeaks(cached.peaks);
            if (!hasDuration) setDuration(cached.duration);
            return;
        }
        let aborted = false;
        const controller = new AbortController();
        setDecoding(true);
        (async () => {
            try {
                const resp = await fetch(signedAudioUrl, { signal: controller.signal });
                if (!resp.ok) throw new Error(`fetch ${resp.status}`);
                const buf = await resp.arrayBuffer();
                const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
                if (!Ctor) throw new Error('Web Audio API unavailable');
                const ctx: AudioContext = new Ctor();
                try {
                    const decoded = await ctx.decodeAudioData(buf.slice(0));
                    if (aborted) return;
                    const computed = computePeaks(decoded, WAVEFORM_BARS);
                    waveformCache.set(cacheKey(signedAudioUrl), { peaks: computed, duration: decoded.duration });
                    setPeaks((prev) => (prev && prev.length > 0 ? prev : computed));
                    setDuration((prev) => (prev > 0 ? prev : decoded.duration));
                } finally {
                    ctx.close().catch(() => {});
                }
            } catch (e) {
                if (!aborted) console.warn('[AudioNode] decode failed', e);
            } finally {
                if (!aborted) setDecoding(false);
            }
        })();
        return () => {
            aborted = true;
            controller.abort();
        };
    }, [showModal, signedAudioUrl]);

    // Bind <audio> element events — drives currentTime + provides a duration
    // fallback in case decode hasn't finished yet.
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const onTime = () => setCurrentTime(audio.currentTime);
        const onMeta = () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                setDuration((prev) => (prev > 0 ? prev : audio.duration));
            }
        };
        const onEnd = () => {
            setIsPlaying(false);
            setCurrentTime(0);
            audio.currentTime = 0;
        };
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        audio.addEventListener('timeupdate', onTime);
        audio.addEventListener('loadedmetadata', onMeta);
        audio.addEventListener('durationchange', onMeta);
        audio.addEventListener('ended', onEnd);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        return () => {
            audio.removeEventListener('timeupdate', onTime);
            audio.removeEventListener('loadedmetadata', onMeta);
            audio.removeEventListener('durationchange', onMeta);
            audio.removeEventListener('ended', onEnd);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
        };
    }, [signedAudioUrl]);

    // Pause playback when modal closes.
    useEffect(() => {
        if (!showModal && audioRef.current && !audioRef.current.paused) {
            audioRef.current.pause();
        }
    }, [showModal]);

    const togglePlay = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
    }, []);

    const seekTo = useCallback((seconds: number) => {
        const audio = audioRef.current;
        if (!audio || !Number.isFinite(seconds)) return;
        const d = duration || audio.duration || 0;
        const clamped = Math.max(0, Math.min(seconds, d || seconds));
        audio.currentTime = clamped;
        setCurrentTime(clamped);
    }, [duration]);

    const handleSkipBack = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        seekTo(audio.currentTime - SKIP_SECONDS);
    }, [seekTo]);

    const handleSkipForward = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        seekTo(audio.currentTime + SKIP_SECONDS);
    }, [seekTo]);

    const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const el = waveformRef.current;
        if (!el || !duration) return;
        const rect = el.getBoundingClientRect();
        const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        seekTo(percentage * duration);
    }, [duration, seekTo]);

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const waveformBars = useMemo(() => {
        if (peaks && peaks.length > 0) return peaks.map((p) => Math.max(0.04, p));
        // Card placeholder: gentle sine so it looks like a waveform but doesn't imply real peaks.
        return Array.from({ length: 64 }, (_, i) =>
            0.25 + 0.5 * Math.abs(Math.sin((i / 63) * Math.PI * 3)),
        );
    }, [peaks]);

    const modalContent = showModal ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-8">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setShowModal(false)}
            />
            <div
                className="relative z-10 w-full max-w-md bg-warm-surface rounded-2xl shadow-2xl p-6 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">Audio Player</h3>
                    <button onClick={() => setShowModal(false)} className="text-slate-700 dark:text-slate-300 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-center py-8 bg-warm-muted rounded-xl">
                        <div className="h-32 w-32 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 dark:text-slate-300 shadow-inner">
                            <SpeakerHigh size={48} weight="fill" />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                            <span>{formatTime(currentTime)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                        <div
                            ref={waveformRef}
                            className="relative flex items-center gap-[2px] h-12 w-full justify-center cursor-pointer group/waveform"
                            onClick={handleWaveformClick}
                        >
                            {decoding && !peaks && (
                                <div className="absolute inset-0 flex items-center justify-center text-slate-700 dark:text-slate-300">
                                    <Spinner size={20} className="animate-spin" />
                                </div>
                            )}
                            {waveformBars.map((p, index) => {
                                const barPercent = ((index + 0.5) / waveformBars.length) * 100;
                                const isPlayed = barPercent <= progress;
                                return (
                                    <div
                                        key={index}
                                        className={`w-1.5 rounded-full transition-all duration-150 ${isPlayed ? 'bg-slate-900' : 'bg-slate-200 group-hover/waveform:bg-slate-300'}`}
                                        style={{ height: `${Math.max(6, p * 100)}%` }}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center justify-center gap-6">
                        <button
                            onClick={handleSkipBack}
                            className="text-slate-700 dark:text-slate-300 hover:text-slate-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            disabled={!duration}
                            aria-label={`Skip back ${SKIP_SECONDS}s`}
                        >
                            <SkipBack size={24} weight="fill" />
                        </button>
                        <button
                            onClick={togglePlay}
                            className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                            disabled={!signedAudioUrl}
                            aria-label={isPlaying ? 'Pause' : 'Play'}
                        >
                            {isPlaying ? (
                                <Pause size={28} weight="fill" />
                            ) : (
                                <Play size={28} weight="fill" className="ml-1" />
                            )}
                        </button>
                        <button
                            onClick={handleSkipForward}
                            className="text-slate-700 dark:text-slate-300 hover:text-slate-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            disabled={!duration}
                            aria-label={`Skip forward ${SKIP_SECONDS}s`}
                        >
                            <SkipForward size={24} weight="fill" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    return (
        <>
            <div className="group relative min-w-[200px]">
                <div
                    className="absolute -top-8 left-4 z-10"
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <input
                        className="bg-transparent text-lg font-bold font-display text-slate-700 dark:text-slate-300 focus:text-slate-900 focus:outline-none"
                        value={label}
                        onChange={(evt) => {
                            setLabel(evt.target.value);
                            data.label = evt.target.value;
                        }}
                    />
                </div>

                <div
                    className={`w-full bg-warm-surface shadow-xl rounded-matrix overflow-hidden transition-all duration-300 hover:shadow-2xl cursor-pointer ${selected ? 'ring-4 ring-slate-900 ring-offset-2' : 'ring-1 ring-slate-200'}`}
                    onClick={() => audioUrl && status === 'completed' && setShowModal(true)}
                >
                    <div className="flex items-center justify-center h-16 px-4">
                        {status === 'draft' ? (
                            <DraftPlaceholder nodeId={id} modality="audio" height={64} />
                        ) : isActiveStatus(status) && !audioUrl ? (
                            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                <Spinner size={24} className="animate-spin" />
                                <span className="text-sm font-medium">Generating audio...</span>
                            </div>
                        ) : status === 'failed' ? (
                            <div className="flex items-center gap-2 text-red-500">
                                <X size={24} weight="bold" />
                                <span className="text-sm font-medium">Generation failed</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 w-full justify-center">
                                <SpeakerHigh size={20} weight="fill" className="text-slate-700 dark:text-slate-300 shrink-0" />
                                <div className="flex items-center gap-[2px] h-8 flex-1 justify-center">
                                    {waveformBars.slice(0, 48).map((p, index) => (
                                        <div
                                            key={index}
                                            className="w-1 rounded-full bg-slate-300"
                                            style={{ height: `${Math.max(12, p * 100)}%` }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {audioUrl && (
                        <audio
                            ref={audioRef}
                            src={signedAudioUrl || undefined}
                            preload="metadata"
                        />
                    )}
                </div>

                <Handle
                    type="target"
                    position={Position.Left}
                    style={{ top: '50%', left: '-8px' }}
                    className="!h-4 !w-4 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-blue-500 hover:scale-125 shadow-sm"
                />
                <SourceHandleMenu nodeId={id} />
            </div>

            {typeof window !== 'undefined' && showModal && createPortal(modalContent, document.body)}
        </>
    );
};

export default memo(AudioNode);
