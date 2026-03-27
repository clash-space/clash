import { memo, useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps } from 'reactflow';
import { Play, Pause, X, SpeakerHigh, SkipBack, SkipForward, Spinner } from '@phosphor-icons/react';
import { resolveAssetUrl } from '../../../lib/utils/assets';
import { normalizeStatus, isActiveStatus, type AssetStatus } from '../../../lib/assetStatus';

const AudioNode = ({ data, selected, id: _id }: NodeProps) => {
    const [label, setLabel] = useState(data.label || 'Audio Node');
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [status, setStatus] = useState<AssetStatus>(normalizeStatus(data.status) || (data.src ? 'completed' : 'generating'));
    const [audioUrl, setAudioUrl] = useState<string | undefined>(data.src);
    const audioRef = useRef<HTMLAudioElement>(null);

    // Generate random waveform bars
    const waveformBars = useMemo(() => {
        return Array.from({ length: 64 }, () => Math.floor(Math.random() * 70) + 30);
    }, []);

    // Sync status and audioUrl from Loro data changes
    useEffect(() => {
        setStatus((prev: AssetStatus) => {
            const next = normalizeStatus(data.status);
            return next !== prev ? next : prev;
        });
        setAudioUrl((prev: string | undefined) => (data.src !== prev ? data.src : prev));
    }, [data.status, data.src]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const updateProgress = () => {
            setProgress((audio.currentTime / audio.duration) * 100);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setProgress(0);
        };

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
        };

        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);

        return () => {
            audio.removeEventListener('timeupdate', updateProgress);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    }, []);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (audioRef.current && duration) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = x / rect.width;
            audioRef.current.currentTime = percentage * duration;
            setProgress(percentage * 100);
        }
    };

    const formatTime = (seconds: number) => {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const [showModal, setShowModal] = useState(false);

    // ... (keep existing state and refs)

    // ... (keep existing effects)

    // ... (keep existing handlers)

    // Modal Content
    const modalContent = showModal ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-8">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setShowModal(false)}
            />
            <div
                className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">Audio Player</h3>
                    <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Full Player UI in Modal */}
                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-center py-8 bg-slate-50 rounded-xl">
                        <div className="h-32 w-32 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 shadow-inner">
                            <SpeakerHigh size={48} weight="fill" />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs font-medium text-slate-500">
                            <span>{formatTime(audioRef.current?.currentTime || 0)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                        {/* Waveform in Modal */}
                        <div
                            className="flex items-center gap-[2px] h-12 w-full justify-center cursor-pointer group/waveform"
                            onClick={handleSeek}
                        >
                            {waveformBars.map((height, index) => {
                                const barPercent = (index / waveformBars.length) * 100;
                                const isPlayed = barPercent <= progress;
                                return (
                                    <div
                                        key={index}
                                        className={`w-1.5 rounded-full transition-all duration-200 ${isPlayed ? 'bg-slate-900' : 'bg-slate-200 group-hover/waveform:bg-slate-300'}`}
                                        style={{ height: `${height}%` }}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center justify-center gap-6">
                        <button className="text-slate-400 hover:text-slate-600">
                            <SkipBack size={24} weight="fill" />
                        </button>
                        <button
                            onClick={togglePlay}
                            className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-lg hover:scale-105 active:scale-95"
                        >
                            {isPlaying ? (
                                <Pause size={28} weight="fill" />
                            ) : (
                                <Play size={28} weight="fill" className="ml-1" />
                            )}
                        </button>
                        <button className="text-slate-400 hover:text-slate-600">
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
                {/* Floating Title Input */}
                <div
                    className="absolute -top-8 left-4 z-10"
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <input
                        className="bg-transparent text-lg font-bold font-display text-slate-500 focus:text-slate-900 focus:outline-none"
                        value={label}
                        onChange={(evt) => {
                            setLabel(evt.target.value);
                            data.label = evt.target.value;
                        }}
                    />
                </div>

                {/* Main Card - Waveform Only */}
                <div
                    className={`w-full bg-white shadow-xl rounded-matrix overflow-hidden transition-all duration-300 hover:shadow-2xl cursor-pointer ${selected ? 'ring-4 ring-slate-900 ring-offset-2' : 'ring-1 ring-slate-200'}`}
                    onClick={() => audioUrl && (status === 'completed') && setShowModal(true)}
                >
                    <div className="flex items-center justify-center h-16 px-4">
                        {/* Show generating state */}
                        {isActiveStatus(status) && !audioUrl ? (
                            <div className="flex items-center gap-2 text-slate-500">
                                <Spinner size={24} className="animate-spin" />
                                <span className="text-sm font-medium">Generating audio...</span>
                            </div>
                        ) : status === 'failed' ? (
                            <div className="flex items-center gap-2 text-red-500">
                                <X size={24} weight="bold" />
                                <span className="text-sm font-medium">Generation failed</span>
                            </div>
                        ) : (
                            /* Waveform Visualization */
                            <div className="flex items-center gap-[2px] h-8 w-full justify-center">
                                {waveformBars.map((height, index) => {
                                    // Animate bars when playing even in minimized view
                                    const activeHeight = isPlaying ? Math.max(height, Math.random() * 80 + 20) : height;
                                    const barPercent = (index / waveformBars.length) * 100;
                                    const isPlayed = barPercent <= progress;

                                    return (
                                        <div
                                            key={index}
                                            className={`w-1 rounded-full transition-all duration-200 ${isPlayed ? 'bg-slate-900' : 'bg-slate-200'}`}
                                            style={{ height: `${activeHeight}%` }}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Hidden Audio Element - kept in DOM for persistence */}
                    {audioUrl && <audio ref={audioRef} src={resolveAssetUrl(audioUrl)} />}
                </div>

                {/* Asset nodes only have output (source) */}
                <Handle
                    type="source"
                    position={Position.Right}
                    className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-slate-900 transition-all hover:scale-125 shadow-sm"
                />
            </div>

            {/* Render Modal */}
            {typeof window !== 'undefined' && showModal && createPortal(modalContent, document.body)}
        </>
    );
};

export default memo(AudioNode);
