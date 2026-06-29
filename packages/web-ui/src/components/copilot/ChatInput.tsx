
import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Plus, Microphone, X, Check, CircleNotch } from '@phosphor-icons/react';
import { lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { runtimeApiUrl } from '@clash/web-ui/lib/runtimeConfig';
import { IconButton } from '../ui/icon-button';
import type { MilkdownEditorHandle, MentionableNode } from '../MilkdownEditor';

// Lazy load MilkdownEditor to avoid SSR issues
const MilkdownEditor = lazy(() => import('../MilkdownEditor'));

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
    /** Runtime mode can accept follow-up prompts while the current agent loop is still running. */
    allowSubmitWhileProcessing?: boolean;
    placeholder?: string;
    variant?: 'default' | 'hero';
    mentionableNodes?: MentionableNode[];
    connectedNodeIds?: string[];
    onMentionAdded?: (nodeId: string) => void;
    /** When present, chat attachments also get registered in the assets table under this project. */
    projectId?: string;
    /** Optional controls rendered inside the composer's bottom toolbar, next to attach. */
    toolbarAccessory?: ReactNode;
    /** Optional controls rendered on the right side before voice/send. */
    rightToolbarAccessory?: ReactNode;
    onCaretTargetChange?: (target: { x: number; y: number } | null) => void;
}

interface LocalAudioConfig {
    asr: {
        enabled: boolean;
        ready: boolean;
        provider: 'builtin-funasr';
        base_url: string | null;
        model: string;
        setup?: {
            provider: 'funasr';
            runtime?: 'builtin-rpc';
            status: 'disabled' | 'needs-install' | 'ready';
        };
    };
}

async function loadLocalAudioConfig(): Promise<LocalAudioConfig> {
    const res = await fetch(runtimeApiUrl('/api/v1/local/audio'), { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as LocalAudioConfig;
}

async function transcribeLocalAudio(blob: Blob): Promise<string> {
    const type = blob.type || 'audio/webm';
    const form = new FormData();
    form.append('file', new File([blob], `voice-${Date.now()}.webm`, { type }));
    const res = await fetch(runtimeApiUrl('/api/v1/local/audio/transcriptions'), {
        method: 'POST',
        credentials: 'include',
        body: form,
    });
    const json = await res.json().catch(() => null) as { text?: string; error?: string } | null;
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    if (!json?.text) throw new Error('Local ASR returned no transcript');
    return json.text;
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
    const res = await fetch(runtimeApiUrl('/upload'), { method: 'POST', body: form });
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
        await fetch(runtimeApiUrl('/api/v1/assets'), {
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
    error,
    onDismissError,
    disabled = false,
    allowSubmitWhileProcessing = false,
    placeholder = 'Ask anything...',
    variant = 'default',
    mentionableNodes,
    connectedNodeIds,
    onMentionAdded,
    projectId,
    toolbarAccessory,
    rightToolbarAccessory,
    onCaretTargetChange,
}: ChatInputProps) {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<MilkdownEditorHandle>(null);
    const editorHostRef = useRef<HTMLDivElement | null>(null);
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
        onCaretTargetChange?.(null);
        onSubmit(text, attachments);
    }, [input, uploading, onInputChange, onSubmit, onCaretTargetChange]);

    const updateCaretTarget = useCallback(() => {
        if (!onCaretTargetChange) return;
        const host = editorHostRef.current;
        const selection = document.getSelection?.();
        if (!host || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
            onCaretTargetChange(null);
            return;
        }

        const anchor = selection.anchorNode;
        const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE
            ? anchor
            : anchor?.parentNode;
        if (!anchorElement || !host.contains(anchorElement)) {
            onCaretTargetChange(null);
            return;
        }

        const range = selection.getRangeAt(0).cloneRange();
        let rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            const marker = document.createElement('span');
            marker.textContent = '\u200b';
            range.insertNode(marker);
            rect = marker.getBoundingClientRect();
            marker.remove();
        }

        if (rect.width === 0 && rect.height === 0) {
            onCaretTargetChange(null);
            return;
        }

        onCaretTargetChange({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        });
    }, [onCaretTargetChange]);

    useEffect(() => {
        if (!onCaretTargetChange) return;
        return () => onCaretTargetChange(null);
    }, [onCaretTargetChange]);

    // ─── ASR ─────────────────────────────────────────────────
    const [isListening, setIsListening] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [voiceSetupError, setVoiceSetupError] = useState<string | null>(null);
    const [audioLevels, setAudioLevels] = useState<number[]>(new Array(24).fill(0));
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const audioContextRef = useRef<AudioContext | null>(null);
    const animFrameRef = useRef<number>(0);
    const streamRef = useRef<MediaStream | null>(null);

    const cleanup = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            try {
                recorder.stop();
            } catch {
                // The recorder can already be stopping after a permission or device error.
            }
        }
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        audioContextRef.current?.close().catch(() => {});
        audioContextRef.current = null;
        streamRef.current = null;
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        setAudioLevels(new Array(24).fill(0));
        setIsListening(false);
    }, []);

    const stopRecorder = useCallback(async (): Promise<Blob[]> => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === 'inactive') return [...recordedChunksRef.current];
        await new Promise<void>((resolve) => {
            recorder.addEventListener('stop', () => resolve(), { once: true });
            recorder.stop();
        });
        return [...recordedChunksRef.current];
    }, []);

    const startListening = useCallback(async () => {
        setVoiceSetupError(null);
        try {
            const audioConfig = await loadLocalAudioConfig();
            if (!audioConfig.asr.enabled || !audioConfig.asr.ready) {
                setVoiceSetupError('Deploy an ASR model in Models first.');
                return;
            }
        } catch {
            setVoiceSetupError('Deploy an ASR model in Models first.');
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            setVoiceSetupError('Local microphone recording is unavailable in this browser.');
            return;
        }

        try {
            recordedChunksRef.current = [];
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const recorder = new MediaRecorder(stream);
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) recordedChunksRef.current.push(event.data);
            };
            recorder.onerror = () => {
                setVoiceSetupError('Local microphone recording failed.');
                cleanup();
            };
            mediaRecorderRef.current = recorder;
            recorder.start();

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
            setIsListening(true);
        } catch {
            setVoiceSetupError('Microphone permission is required for local ASR.');
            cleanup();
        }
    }, [cleanup]);

    const confirmVoice = useCallback(async () => {
        if (isTranscribing) return;
        setIsTranscribing(true);
        setVoiceSetupError(null);
        try {
            const chunks = await stopRecorder();
            const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
            const blob = new Blob(chunks, { type: mimeType });
            cleanup();
            if (!blob.size) {
                setVoiceSetupError('No microphone audio was captured.');
                return;
            }
            const text = (await transcribeLocalAudio(blob)).trim();
            if (text) onInputChange(input ? `${input} ${text}` : text);
        } catch (err) {
            setVoiceSetupError(err instanceof Error ? err.message : String(err));
            cleanup();
        } finally {
            setIsTranscribing(false);
        }
    }, [cleanup, input, isTranscribing, onInputChange, stopRecorder]);

    useEffect(() => () => cleanup(), [cleanup]);

    // ─── Drop ────────────────────────────────────────────────
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    const actionLocked = isCreatingSession || disabled;
    const submitLocked = actionLocked || (isProcessing && !allowSubmitWhileProcessing);
    const canSend = input.trim() && !submitLocked && uploading === 0;
    const showQueuedSend = isProcessing && allowSubmitWhileProcessing && canSend;
    const isHero = variant === 'hero';
    // placeholder prop is currently unused by MilkdownEditor; reference it
    // so TS/lint doesn't flag it as unused while keeping the public API.
    void placeholder;

    return (
        <div className={isHero ? '' : 'px-4 pb-4'}>
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
                            className="clash-chat-input-alert-error mb-2 px-3 py-1.5 text-xs rounded-lg text-center cursor-pointer"
                            onClick={onDismissError}
                        >
                            {error}
                        </motion.div>
                    )}
                    {voiceSetupError && (
                        <motion.div
                            role="alert"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            className="clash-chat-input-alert-error mb-2 px-3 py-1.5 text-xs rounded-lg text-center"
                        >
                            <span>{voiceSetupError}</span>
                            {' '}
                            <a
                                href="/settings?section=models"
                                className="font-semibold underline underline-offset-2"
                            >
                                Open Models
                            </a>
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {/* Main input card */}
            <div
                className={`clash-chat-input-surface ${isHero ? 'rounded-[2rem] p-2' : 'rounded-[18px]'}`}
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
                                disabled={isTranscribing}
                                icon={<X className="w-4 h-4" weight="bold" />}
                            />
                            <IconButton
                                onClick={confirmVoice}
                                label={t('copilot.chatInput.confirmVoice')}
                                disabled={isTranscribing}
                                icon={isTranscribing ? <CircleNotch className="w-4 h-4 animate-spin motion-reduce:animate-none" weight="bold" /> : <Check className="w-4 h-4" weight="bold" />}
                            />
                        </div>
                    </div>
                ) : (
                    /* ─── Rich text input ─── */
                    <div className={isHero ? 'flex min-h-[142px] flex-col' : ''}>
                        <div
                            ref={editorHostRef}
                            className={`clash-chat-input-editor ${isHero ? 'clash-chat-input-editor--hero' : 'clash-chat-input-editor--default'} milkdown-chat-input w-full text-left chat-scroll-hidden ${isHero ? 'min-h-[100px] flex-1 px-5 pt-4' : 'min-h-[52px] max-h-[200px]'} overflow-y-auto`}
                            onFocusCapture={() => window.requestAnimationFrame(updateCaretTarget)}
                            onBlurCapture={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                    onCaretTargetChange?.(null);
                                }
                            }}
                            onKeyUp={() => window.requestAnimationFrame(updateCaretTarget)}
                            onPointerUp={() => window.requestAnimationFrame(updateCaretTarget)}
                            onInput={() => window.requestAnimationFrame(updateCaretTarget)}
                        >
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
                            <div className="flex min-w-0 items-center gap-2">
                                <IconButton
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={actionLocked}
                                    label={t('copilot.chatInput.attach')}
                                    shape="rounded"
                                    icon={<Plus className="w-4 h-4" weight="bold" />}
                                    className="-ml-1.5"
                                />
                                {!isHero && toolbarAccessory ? (
                                    <div className="min-w-0">
                                        {toolbarAccessory}
                                    </div>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-1.5 -mr-1.5">
                                {!isHero && rightToolbarAccessory ? (
                                    <div className="min-w-0">
                                        {rightToolbarAccessory}
                                    </div>
                                ) : null}
                                <IconButton
                                    onClick={startListening}
                                    disabled={actionLocked}
                                    label={t('copilot.chatInput.voice')}
                                    shape="rounded"
                                    icon={<Microphone className="w-4 h-4" weight="bold" />}
                                />
                                {showQueuedSend ? (
                                    <button
                                        type="button"
                                        onClick={handleFormSubmit}
                                        disabled={!canSend}
                                        aria-label={t('copilot.chatInput.send')}
                                        className="clash-chat-input-primary w-9 h-9 min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                                    >
                                        <ArrowUp className="w-3.5 h-3.5" weight="bold" aria-hidden="true" />
                                    </button>
                                ) : null}
                                {isProcessing && onStop ? (
                                    <button
                                        type="button"
                                        onClick={onStop}
                                        aria-label={t('copilot.chatInput.stop')}
                                        className="clash-chat-input-stop w-9 h-9 min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                                    >
                                        <span className="h-2.5 w-2.5 rounded-[3px] bg-current" aria-hidden="true" />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleFormSubmit}
                                        disabled={!canSend && !isCreatingSession}
                                        aria-label={t('copilot.chatInput.send')}
                                        aria-busy={isCreatingSession || uploading > 0}
                                        className={`w-9 h-9 min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface ${isCreatingSession || uploading > 0
                                            ? 'clash-chat-input-primary focus-visible:ring-brand'
                                            : canSend
                                                ? 'clash-chat-input-primary focus-visible:ring-brand'
                                                : 'bg-warm-muted text-slate-500 dark:text-slate-500 cursor-not-allowed focus-visible:ring-brand'
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
