'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Plus, Microphone, X, Check, StopCircle, CircleNotch } from '@phosphor-icons/react';
import dynamic from 'next/dynamic';
import { getSignedUrl } from '../../../lib/hooks/useSignedUrl';
import type { MilkdownEditorHandle } from '../MilkdownEditor';

// Lazy load MilkdownEditor to avoid SSR issues
const MilkdownEditor = dynamic(() => import('../MilkdownEditor'), { ssr: false });

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
}: ChatInputProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<MilkdownEditorHandle>(null);
    const [uploading, setUploading] = useState(0);

    // ─── File upload → insert into editor on complete ──────────
    const handleFiles = useCallback((files: FileList | File[]) => {
        console.log('[ChatInput] handleFiles', files.length, 'files, editorRef:', !!editorRef.current);
        Array.from(files).forEach(async (file) => {
            const type = classifyFile(file);
            const name = file.name;

            setUploading(n => n + 1);
            try {
                console.log('[ChatInput] uploading:', name);
                const { storageKey } = await uploadFile(file);
                console.log('[ChatInput] uploaded:', storageKey);
                const signedUrl = await getSignedUrl(storageKey);
                console.log('[ChatInput] signed:', signedUrl.slice(0, 60));
                const md = type === 'image'
                    ? `![${name}](${signedUrl})`
                    : `[${name}](${signedUrl})`;
                editorRef.current?.insertAtCursor(md + ' ');
                console.log('[ChatInput] inserted into editor, ref:', !!editorRef.current);
            } catch (err) {
                console.error('[ChatInput] upload failed:', err);
                editorRef.current?.insertAtCursor(`⚠️ Failed to upload ${name} `);
            } finally {
                setUploading(n => n - 1);
            }
        });
    }, []);

    // ─── Submit ──────────────────────────────────────────────
    const handleFormSubmit = useCallback(() => {
        const text = input.trim();
        if (!text || uploading > 0) return;
        const attachments = extractAssetKeys(text);
        onInputChange('');
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
        recognition.lang = 'zh-CN';
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (e: any) => {
            transcriptRef.current = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
        };
        recognition.onerror = () => cleanup();
        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);

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

    return (
        <div className={isHero ? '' : 'px-4 py-3'}>
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
            />

            {/* Error banner */}
            {!isHero && (
                <AnimatePresence>
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            className="mb-2 px-3 py-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg text-center cursor-pointer hover:bg-red-100 transition-colors"
                            onClick={onDismissError}
                        >
                            {error}
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {/* Main input card */}
            <div
                className={`bg-white border border-slate-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md focus-within:shadow-md focus-within:border-slate-300 ${isHero ? 'rounded-[2rem] p-2' : 'rounded-2xl'}`}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
            >
                {isListening ? (
                    /* ─── Voice recording ─── */
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-center gap-[2px] h-10 my-1">
                            {audioLevels.map((level, i) => (
                                <div
                                    key={i}
                                    className="w-[3px] rounded-full bg-slate-800 transition-all duration-75"
                                    style={{ height: `${Math.max(3, level * 32)}px` }}
                                />
                            ))}
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                            <button onClick={cleanup} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                                <X className="w-4 h-4" weight="bold" />
                            </button>
                            <button onClick={confirmVoice} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors">
                                <Check className="w-4 h-4" weight="bold" />
                            </button>
                        </div>
                    </div>
                ) : (
                    /* ─── Rich text input ─── */
                    <div>
                        <div className={`milkdown-chat-input ${isHero ? 'min-h-[100px]' : 'min-h-[40px] max-h-[200px]'} overflow-y-auto`}>
                            <MilkdownEditor
                                ref={editorRef}
                                value={input}
                                onChange={onInputChange}
                                promptModalities={['text', 'image']}
                            />
                        </div>

                        {/* Uploading indicator */}
                        {uploading > 0 && (
                            <div className="flex items-center gap-1.5 px-4 pb-1 text-xs text-slate-400">
                                <CircleNotch className="w-3 h-3 animate-spin" />
                                <span>Uploading {uploading} file{uploading > 1 ? 's' : ''}...</span>
                            </div>
                        )}

                        {/* Bottom toolbar */}
                        <div className={`flex items-center justify-between pb-2.5 ${isHero ? 'px-5' : 'px-4'}`}>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isBusy}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30"
                                    title="Attach files"
                                >
                                    <Plus className="w-4 h-4" weight="bold" />
                                </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                                {!isHero && (
                                    <div
                                        className={`w-2 h-2 rounded-full transition-colors ${connected ? 'bg-emerald-500' : 'bg-red-400'}`}
                                        title={connected ? 'Connected' : 'Disconnected'}
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={startListening}
                                    disabled={isBusy}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30"
                                    title="Voice input"
                                >
                                    <Microphone className="w-4 h-4" weight="bold" />
                                </button>
                                {isProcessing && onStop ? (
                                    <button
                                        type="button"
                                        onClick={onStop}
                                        className="w-7 h-7 rounded-full flex items-center justify-center bg-slate-800 text-white hover:bg-red-600 transition-colors"
                                    >
                                        <StopCircle className="w-4 h-4" weight="fill" />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleFormSubmit}
                                        disabled={!canSend && !isCreatingSession}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isCreatingSession || uploading > 0
                                            ? 'bg-slate-800 text-white'
                                            : canSend
                                                ? 'bg-slate-800 text-white hover:bg-slate-700'
                                                : 'bg-slate-200 text-slate-400'
                                            }`}
                                    >
                                        {isCreatingSession || uploading > 0 ? (
                                            <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <ArrowUp className="w-3.5 h-3.5" weight="bold" />
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
