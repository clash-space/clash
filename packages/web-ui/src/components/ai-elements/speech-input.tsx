import { ArrowUp, CircleNotch } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js';

import { IconButton } from '../ui/icon-button';
import { cn } from './utils';

export type SpeechInputCompletionIntent = 'transcribe' | 'send';

interface SpeechInputRecordingProps {
    elapsedSeconds: number;
    processingIntent: SpeechInputCompletionIntent | null;
    leading?: ReactNode;
    onCompletionIntentChange: (intent: SpeechInputCompletionIntent | null) => void;
    onRecordingProgress: (elapsedSeconds: number) => void;
    onRecordingComplete: (blob: Blob, intent: SpeechInputCompletionIntent) => void;
    onRecordingError: (error: unknown) => void;
    regionLabel: string;
    recordingDurationLabel: string;
    stopAndTranscribeLabel: string;
    stopTranscribeAndSendLabel: string;
    className?: string;
}

function formatElapsedTime(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Recording footer backed by WaveSurfer's RecordPlugin. The plugin owns the
 * microphone, MediaRecorder, sampling window, and waveform renderer so every
 * composer variant shares one recording lifecycle rather than duplicating it.
 */
export function SpeechInputRecording({
    elapsedSeconds,
    processingIntent,
    leading,
    onCompletionIntentChange,
    onRecordingProgress,
    onRecordingComplete,
    onRecordingError,
    regionLabel,
    recordingDurationLabel,
    stopAndTranscribeLabel,
    stopTranscribeAndSendLabel,
    className,
}: SpeechInputRecordingProps) {
    const waveformRef = useRef<HTMLDivElement | null>(null);
    const recorderRef = useRef<RecordPlugin | null>(null);
    const requestedIntentRef = useRef<SpeechInputCompletionIntent | null>(null);
    const elapsedSecondsRef = useRef(0);
    const callbacksRef = useRef({
        onCompletionIntentChange,
        onRecordingProgress,
        onRecordingComplete,
        onRecordingError,
    });
    callbacksRef.current = {
        onCompletionIntentChange,
        onRecordingProgress,
        onRecordingComplete,
        onRecordingError,
    };

    useEffect(() => {
        const waveform = waveformRef.current;
        if (!waveform) return;

        let disposed = false;
        const color = getComputedStyle(waveform).color;
        const wavesurfer = WaveSurfer.create({
            container: waveform,
            height: 32,
            waveColor: color,
            progressColor: color,
            cursorWidth: 0,
            barWidth: 2,
            barGap: 2,
            barRadius: 2,
            barMinHeight: 1,
            fillParent: true,
            interact: false,
            hideScrollbar: true,
            normalize: false,
        });
        const recorder = wavesurfer.registerPlugin(RecordPlugin.create({
            renderRecordedAudio: false,
            scrollingWaveform: true,
            scrollingWaveformWindow: 20,
            mediaRecorderTimeslice: 250,
        }));
        recorderRef.current = recorder;

        const unsubscribers = [
            recorder.on('record-start', () => {
                if (disposed) return;
                const requestedIntent = requestedIntentRef.current;
                if (requestedIntent) recorder.stopRecording();
            }),
            recorder.on('record-progress', (durationMs) => {
                if (disposed) return;
                const elapsedSeconds = Math.floor(durationMs / 1_000);
                if (elapsedSeconds === elapsedSecondsRef.current) return;
                elapsedSecondsRef.current = elapsedSeconds;
                callbacksRef.current.onRecordingProgress(elapsedSeconds);
            }),
            recorder.on('record-end', (blob) => {
                if (disposed) return;
                const requestedIntent = requestedIntentRef.current;
                if (!requestedIntent) return;
                callbacksRef.current.onRecordingComplete(blob, requestedIntent);
            }),
        ];

        void recorder.startRecording().catch((error) => {
            if (!disposed) callbacksRef.current.onRecordingError(error);
        });

        return () => {
            disposed = true;
            recorderRef.current = null;
            unsubscribers.forEach((unsubscribe) => unsubscribe());
            wavesurfer.destroy();
        };
    }, []);

    const requestCompletion = useCallback((intent: SpeechInputCompletionIntent) => {
        if (requestedIntentRef.current) return;
        requestedIntentRef.current = intent;
        callbacksRef.current.onCompletionIntentChange(intent);
        const recorder = recorderRef.current;
        if (recorder?.isRecording()) recorder.stopRecording();
    }, []);

    const isProcessing = processingIntent !== null;

    return (
        <div
            role="region"
            aria-label={regionLabel}
            aria-busy={isProcessing}
            className={cn(
                'clash-chat-input-actions clash-voice-recording-toolbar flex min-w-0 items-center gap-2 px-4 pb-2.5 pt-1.5',
                className,
            )}
        >
            {leading}
            <div
                className="clash-voice-recording-waveform relative flex h-9 min-w-12 flex-1 items-center overflow-hidden"
                role="status"
                aria-live="polite"
            >
                <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-1/2 border-t border-dashed border-content-disabled/55"
                />
                <div
                    ref={waveformRef}
                    data-waveform-engine="wavesurfer-record"
                    aria-hidden="true"
                    className="absolute inset-0 z-[1] text-content-primary"
                />
            </div>
            <output
                aria-label={recordingDurationLabel}
                className="min-w-[2.75rem] shrink-0 tabular-nums text-sm text-content-muted"
            >
                {formatElapsedTime(elapsedSeconds)}
            </output>
            <IconButton
                onClick={() => requestCompletion('transcribe')}
                label={stopAndTranscribeLabel}
                disabled={isProcessing}
                aria-busy={processingIntent === 'transcribe'}
                shape="circle"
                size="md"
                className="shrink-0 bg-warm-muted text-content-primary hover:bg-warm-border"
                icon={processingIntent === 'transcribe' ? (
                    <CircleNotch
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        weight="bold"
                    />
                ) : (
                    <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
                )}
            />
            <IconButton
                onClick={() => requestCompletion('send')}
                label={stopTranscribeAndSendLabel}
                disabled={isProcessing}
                aria-busy={processingIntent === 'send'}
                shape="circle"
                size="md"
                className="clash-chat-input-primary shrink-0"
                icon={processingIntent === 'send' ? (
                    <CircleNotch
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        weight="bold"
                    />
                ) : (
                    <ArrowUp className="h-4 w-4" weight="bold" />
                )}
            />
        </div>
    );
}
