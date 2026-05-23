
import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Plus, Microphone, X, Check, StopCircle, CircleNotch } from '@phosphor-icons/react';
import { lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { resolveSpeechRecognitionLocale } from '@clash/web-ui/lib/utils/speechRecognitionLocale';
import { IconButton } from '../ui/icon-button';
import type { MilkdownEditorHandle, MentionableNode } from '../MilkdownEditor';

// Lazy load MilkdownEditor to avoid SSR issues
const MilkdownEditor = lazy(() => import('../MilkdownEditor'));

declare global {
    interface Window { SpeechRecognition?: any; webkitSpeechRecognition?: any; }
}

// ─── Types ───────────────────────────────────────────────────

export interface UploadedAttachment {
    id: string;
    fileName: string;
    fileType: string;
    type: 'image' | 'video' | 'audio' | 'document';
    storageKey: string;
    url: string;
    naturalWidth?: number;
    naturalHeight?: number;
}

interface ChatInputProps {
    input: string;
    onInputChange: (value: string) => void;
    /** Called with markdown text + extracted asset keys on send */
    onSubmit: (text: string, attachments: UploadedAttachment[]) => void;
    onStop?: () => void;
    isProcessing?: boolean;
    isCreatingSession?: boolean;
    connected?: boolean;
    error?: string | null;
    onDismissError?: () => void;
    disabled?: boolean;
    placeholder?: string;
    variant?: 'default' | 'hero';
    mentionableNodes?: MentionableNode[];
    connectedNodeIds?: string[];
    onMentionAdded?: (nodeId: string) => void;
    /** When present, chat attachments also get registered in the assets table under this project. */
    projectId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function classifyFile(file: File): UploadedAttachment['type'] {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'document';
}

async function uploadFile(file: File): Promise<{ storageKey: string; url: string }> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
}

/** Probe dimensions / duration for an uploaded file so the asset row carries real metadata. */
async function probeMediaMetadata(
    file: File,
    kind: 'image' | 'video' | 'audio',
): Promise<{ width?: number; height?: number; durationMs?: number }> {
    const objectUrl = URL.createObjectURL(file);
    try {
        if (kind === 'image') {
            return await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
                img.onerror = () => resolve({});
                img.src = objectUrl;
            });
        }
        if (kind === 'video') {
            return await new Promise((resolve) => {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () =>
                    resolve({
                        width: video.videoWidth,
                        height: video.videoHeight,
                        durationMs: Math.round((video.duration || 0) * 1000),
                    });
                video.onerror = () => resolve({});
                video.src = objectUrl;
            });
        }
        if (kind === 'audio') {
            return await new Promise((resolve) => {
                const audio = document.createElement('audio');
                audio.preload = 'metadata';
                audio.onloadedmetadata = () => resolve({ durationMs: Math.round((audio.duration || 0) * 1000) });
                audio.onerror = () => resolve({});
                audio.src = objectUrl;
            });
        }
        return {};
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

/** Capture a JPEG poster from a video file by seeking to a tiny offset
 *  (so we land past the black first frame), drawing to a canvas, and
 *  returning a `data:image/jpeg` URI sized at most 512px wide. Returns
 *  `null` on any failure (corrupt video, decode error, blank frame).
 *
 *  Lifted from `VideoNode.tsx:captureThumbnail` — same trick as the
 *  legacy ChatbotCopilot's `<video src='url#t=0.1'>` preview, but
 *  rasterized so the chat editor (which only knows `image` nodes) can
 *  display it inline as a normal image chip. */
async function captureVideoCover(file: File): Promise<string | null> {
    const objectUrl = URL.createObjectURL(file);
    try {
        return await new Promise<string | null>((resolve) => {
            const video = document.createElement('video');
            video.preload = 'auto';
            video.muted = true;
            video.playsInline = true;
            video.crossOrigin = 'anonymous';
            const cleanup = () => {
                video.removeAttribute('src');
                video.load();
            };
            let resolved = false;
            const finish = (out: string | null) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(out);
            };
            video.onerror = () => finish(null);
            video.onloadeddata = () => {
                try {
                    // Seek a hair past zero — first frame is often black on
                    // many codecs / muxers.
                    video.currentTime = Math.min(0.1, (video.duration || 0) * 0.05);
                } catch {
                    finish(null);
                }
            };
            video.onseeked = () => {
                try {
                    if (!video.videoWidth || !video.videoHeight) { finish(null); return; }
                    const canvas = document.createElement('canvas');
                    const maxW = 512;
                    const ratio = video.videoWidth / video.videoHeight;
                    canvas.width = Math.min(maxW, video.videoWidth);
                    canvas.height = Math.max(1, Math.round(canvas.width / ratio));
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { finish(null); return; }
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    finish(canvas.toDataURL('image/jpeg', 0.7));
                } catch {
                    finish(null);
                }
            };
            video.src = objectUrl;
            // Fail-safe timeout: don't hang the upload toast forever if
            // the decoder never fires `seeked`.
            setTimeout(() => finish(null), 4000);
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

/** Register the uploaded file as an asset row. Silently no-ops if no project context. */
async function registerAsset(
    projectId: string | undefined,
    storageKey: string,
    file: File,
    kind: 'image' | 'video' | 'audio' | 'document',
): Promise<void> {
    if (!projectId) return;
    if (kind === 'document') return; // documents aren't media assets
    try {
        const meta = await probeMediaMetadata(file, kind);
        await fetch('/api/v1/assets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                projectId,
                kind,
                srcR2Key: storageKey,
                bytes: file.size,
                ...meta,
            }),
        });
    } catch (e) {
        console.warn('[ChatInput] asset registration failed', e);
    }
}

/** Extract asset keys from markdown images: ![...](/assets/uploads/xxx?sig=...) */
function extractAssetKeys(markdown: string): UploadedAttachment[] {
    const results: UploadedAttachment[] = [];
    // Match /assets/{storageKey}?exp=...&sig=... — extract storageKey before query params
    const regex = /!\[([^\]]*)\]\(\/assets\/(uploads\/[^?)]+)[^)]*\)/g;
    let m;
    while ((m = regex.exec(markdown)) !== null) {
        const fileName = m[1] || m[2].split('/').pop() || '';
        const storageKey = m[2];
        const ext = storageKey.split('.').pop()?.toLowerCase() || '';
        const type = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ? 'image' as const
            : ['mp4', 'mov', 'webm'].includes(ext) ? 'video' as const
            : ['mp3', 'wav', 'ogg'].includes(ext) ? 'audio' as const
            : 'document' as const;
        results.push({ id: storageKey, fileName, fileType: '', type, storageKey, url: '' });
    }
    return results;
}

/** Convert inline mention images ![mention:nodeId:label](url) back to @[label](node:id) */
function restoreMentions(markdown: string): string {
    return markdown.replace(/!\[mention:([^:]+):([^\]]*)\]\([^)]*\)/g, (_match, nodeId, label) => {
        return `@[${label}](node:${nodeId})`;
    });
}

const ACCEPT = 'image/*,video/*,audio/*,.pdf,.txt,.md,.markdown,.json,.csv,.srt,.vtt';

// ─── Component ───────────────────────────────────────────────

export function ChatInput({
    input,
    onInputChange,
    onSubmit,
    onStop,
    isProcessing = false,
    isCreatingSession = false,
    connected = true,
    error,
    onDismissError,
    disabled = false,
    placeholder = 'Ask anything...',
    variant = 'default',
    mentionableNodes,
    connectedNodeIds,
    onMentionAdded,
    projectId,
}: ChatInputProps) {
    const { t, i18n } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<MilkdownEditorHandle>(null);
    const [uploading, setUploading] = useState(0);

    // ─── File upload → insert into editor on complete ──────────
    const handleFiles = useCallback((files: FileList | File[]) => {
        Array.from(files).forEach(async (file) => {
            const type = classifyFile(file);
            const name = file.name;

            setUploading(n => n + 1);
            try {
                const { storageKey } = await uploadFile(file);
                void registerAsset(projectId, storageKey, file, type);
                const signedUrl = await getSignedUrl(storageKey);

                let md: string;
                if (type === 'image') {
                    md = `![${name}](${signedUrl})`;
                } else if (type === 'video') {
                    const cover = await captureVideoCover(file);
                    md = cover
                        ? `![video:${storageKey}:${name}](${cover})`
                        : `[🎬 ${name}](${signedUrl})`;
                } else if (type === 'audio') {
                    md = `[🔊 ${name}](${signedUrl})`;
                } else {
                    md = `[📄 ${name}](${signedUrl})`;
                }
                editorRef.current?.insertAtCursor(md + ' ');
            } catch (err) {
                console.error('[ChatInput] upload failed:', err);
                editorRef.current?.insertAtCursor(t('copilot.chatInput.uploadFailed', { name }));
            } finally {
                setUploading(n => n - 1);
            }
        });
    }, [projectId, t]);

    // ─── Submit ──────────────────────────────────────────────
    const handleFormSubmit = useCallback(() => {
        const raw = input.trim();
        if (!raw || uploading > 0) return;
        const text = restoreMentions(raw);
        const attachments = extractAssetKeys(text);
        onInputChange('');
        editorRef.current?.clear();
        onSubmit(text, attachments);
    }, [input, uploading, onInputChange, onSubmit]);

    // ─── ASR ─────────────────────────────────────────────────
    const [isListening, setIsListening] = useState(false);
    const [audioLevels, setAudioLevels] = useState<number[]>(new Array(24).fill(0));
    const recognitionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const animFrameRef = useRef<number>(0);
    const streamRef = useRef<MediaStream | null>(null);
    const transcriptRef = useRef('');

    const cleanup = useCallback(() => {
        recognitionRef.current?.stop();
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        audioContextRef.current?.close().catch(() => {});
        audioContextRef.current = null;
        streamRef.current = null;
        recognitionRef.current = null;
        setAudioLevels(new Array(24).fill(0));
        setIsListening(false);
    }, []);

    const startListening = useCallback(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        transcriptRef.current = '';
        const recognition = new SR();
        recognition.lang = resolveSpeechRecognitionLocale(i18n.language);
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (e: any) => {
            transcriptRef.current = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
        };
        recognition.onerror = () => cleanup();
        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);

        if (!navigator.mediaDevices?.getUserMedia) return;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            streamRef.current = stream;
            const ctx = new AudioContext();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.7;
            ctx.createMediaStreamSource(stream).connect(analyser);
            audioContextRef.current = ctx;
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
                analyser.getByteFrequencyData(data);
                const bars: number[] = [];
                const step = Math.max(1, Math.floor(data.length / 24));
                for (let i = 0; i < 24; i++) bars.push(data[i * step] / 255);
                setAudioLevels(bars);
                animFrameRef.current = requestAnimationFrame(tick);
            };
            tick();
        }).catch(() => {});
    }, [cleanup]);

    const confirmVoice = useCallback(() => {
        const text = transcriptRef.current.trim();
        cleanup();
        if (text) onInputChange(input ? `${input} ${text}` : text);
    }, [cleanup, onInputChange, input]);

    useEffect(() => () => cleanup(), [cleanup]);

    // ─── Drop ────────────────────────────────────────────────
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    const isBusy = isProcessing || isCreatingSession || disabled;
    const canSend = input.trim() && !isBusy && uploading === 0;
    const isHero = variant === 'hero';
    // placeholder prop is currently unused by MilkdownEditor; reference it
    // so TS/lint doesn't flag it as unused while keeping the public API.
    void placeholder;

    return (
        <div className={isHero ? '' : 'px-4 pb-3'}>
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
            />

            {/* Error banner */}
            {!isHero && (
                <AnimatePresence>
                    {error && (
                        <motion.div
                            role="alert"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            className="mb-2 px-3 py-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg text-center cursor-pointer hover:bg-red-100 transition-colors dark:text-red-300 dark:bg-red-950/30 dark:border-red-900/50 dark:hover:bg-red-950/50"
                            onClick={onDismissError}
                        >
                            {error}
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {/* Main input card */}
            <div
                className={`clash-chat-input-surface ${isHero ? 'rounded-[2rem] p-2' : 'rounded-2xl'}`}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
            >
                {isListening ? (
                    /* ─── Voice recording ─── */
                    <div className="px-4 py-3" role="region" aria-label={t('copilot.chatInput.voice')}>
                        <div
                            className="flex items-center justify-center gap-[2px] h-10 my-1"
                            role="status"
                            aria-live="polite"
                            aria-label={t('copilot.chatInput.voice')}
                        >
                            {audioLevels.map((level, i) => (
                                <div
                                    key={i}
                                    aria-hidden="true"
                                    className="w-[3px] rounded-full bg-slate-800 dark:bg-slate-200 transition-all duration-75 motion-reduce:transition-none"
                                    style={{ height: `${Math.max(3, level * 32)}px` }}
                                />
                            ))}
                        </div>
                        <div className="clash-chat-input-actions flex items-center justify-end gap-2 pt-2">
                            <IconButton
                                onClick={cleanup}
                                label={t('copilot.chatInput.cancelVoice')}
                                icon={<X className="w-4 h-4" weight="bold" />}
                            />
                            <IconButton
                                onClick={confirmVoice}
                                label={t('copilot.chatInput.confirmVoice')}
                                icon={<Check className="w-4 h-4" weight="bold" />}
                            />
                        </div>
                    </div>
                ) : (
                    /* ─── Rich text input ─── */
                    <div className={isHero ? 'flex min-h-[142px] flex-col' : ''}>
                        <div className={`clash-chat-input-editor milkdown-chat-input w-full text-left chat-scroll-hidden ${isHero ? 'min-h-[100px] flex-1 px-5 pt-4' : 'min-h-[40px] max-h-[200px]'} overflow-y-auto`}>
                            <MilkdownEditor
                                ref={editorRef}
                                value={input}
                                onChange={onInputChange}
                                onSubmit={handleFormSubmit}
                                promptModalities={['text', 'image']}
                                mentionableNodes={mentionableNodes}
                                connectedNodeIds={connectedNodeIds}
                                onMentionAdded={onMentionAdded}
                            />
                        </div>

                        {/* Uploading indicator */}
                        {uploading > 0 && (
                            <div
                                role="status"
                                aria-live="polite"
                                className="flex items-center gap-1.5 px-4 pb-1 text-xs text-slate-700 dark:text-slate-300"
                            >
                                <CircleNotch className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                <span>{t('copilot.chatInput.uploading', { count: uploading })}</span>
                            </div>
                        )}

                        {/* Bottom toolbar */}
                        <div className={`clash-chat-input-actions flex items-center justify-between pb-2.5 pt-1.5 ${isHero ? 'px-5' : 'px-4'}`}>
                            <div className="flex items-center gap-1">
                                <IconButton
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isBusy}
                                    label={t('copilot.chatInput.attach')}
                                    shape="rounded"
                                    icon={<Plus className="w-4 h-4" weight="bold" />}
                                    className="-ml-1.5"
                                />
                            </div>
                            <div className="flex items-center gap-1.5 -mr-1.5">
                                {!isHero && (
                                    <div
                                        role="status"
                                        aria-live="polite"
                                        aria-label={connected ? t('copilot.status.connected') : t('copilot.status.disconnected')}
                                        className="flex items-center"
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`block w-2.5 h-2.5 rounded-full transition-colors ${connected ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-500 dark:bg-red-400'}`}
                                        />
                                    </div>
                                )}
                                <IconButton
                                    onClick={startListening}
                                    disabled={isBusy}
                                    label={t('copilot.chatInput.voice')}
                                    shape="rounded"
                                    icon={<Microphone className="w-4 h-4" weight="bold" />}
                                />
                                {isProcessing && onStop ? (
                                    <button
                                        type="button"
                                        onClick={onStop}
                                        aria-label={t('copilot.chatInput.stop')}
                                        className="w-9 h-9 min-h-[36px] min-w-[36px] rounded-full flex items-center justify-center bg-slate-800 text-white hover:bg-red-600 transition-colors dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-red-500 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                                    >
                                        <StopCircle className="w-4 h-4" weight="fill" aria-hidden="true" />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleFormSubmit}
                                        disabled={!canSend && !isCreatingSession}
                                        aria-label={t('copilot.chatInput.send')}
                                        aria-busy={isCreatingSession || uploading > 0}
                                        className={`w-9 h-9 min-h-[36px] min-w-[36px] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface ${isCreatingSession || uploading > 0
                                            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 focus-visible:ring-slate-500'
                                            : canSend
                                                ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white focus-visible:ring-slate-500'
                                                : 'bg-warm-muted text-slate-500 dark:text-slate-500 cursor-not-allowed focus-visible:ring-slate-400'
                                            }`}
                                    >
                                        {isCreatingSession || uploading > 0 ? (
                                            <CircleNotch className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                        ) : (
                                            <ArrowUp className="w-3.5 h-3.5" weight="bold" aria-hidden="true" />
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
