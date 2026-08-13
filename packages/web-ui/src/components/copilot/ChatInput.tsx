import {
  forwardRef,
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  type ForwardedRef,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Plus, Microphone, CircleNotch } from "@phosphor-icons/react";
import { lazy } from "react";
import { useTranslation } from "react-i18next";
import { useDropzone, type Accept } from "react-dropzone";
import { importProjectAssetFile } from "@clash/web-ui/lib/hooks/useAsset";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import {
  SpeechInputRecording,
  type SpeechInputCompletionIntent,
} from "../ai-elements/speech-input";
import type { AgentAnnotationDraft } from "@clash/shared-types";
import type { MilkdownEditorHandle, MentionableNode } from "../MilkdownEditor";
import { AgentAnnotationTray } from "./AgentAnnotationBlock";
import {
  VoiceInputSetupPopover,
  type VoiceInputNotice,
} from "./VoiceInputSetupPopover";

// Lazy load MilkdownEditor to avoid SSR issues
const MilkdownEditor = lazy(() => import("../MilkdownEditor"));

// ─── Types ───────────────────────────────────────────────────

export interface UploadedAttachment {
  id: string;
  fileName: string;
  fileType: string;
  type: "image" | "video" | "audio";
  assetId: string;
  url: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  /** Called with markdown text + extracted asset keys on send */
  onSubmit: (
    text: string,
    attachments: UploadedAttachment[],
    annotations: AgentAnnotationDraft[],
  ) => void;
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
  variant?: "default" | "hero";
  mentionableNodes?: MentionableNode[];
  connectedNodeIds?: string[];
  onMentionAdded?: (nodeId: string) => void;
  /** Attachments are available only with an owning Project Asset scope. */
  projectId?: string;
  /** Optional controls rendered inside the composer's bottom toolbar, next to attach. */
  toolbarAccessory?: ReactNode;
  /** Optional controls rendered on the right side before voice/send. */
  rightToolbarAccessory?: ReactNode;
  onCaretTargetChange?: (target: { x: number; y: number } | null) => void;
  /** Structured review context attached from Canvas, Timeline, or Director Stage. */
  annotationBlocks?: AgentAnnotationDraft[];
  onAnnotationOpen?: (annotationId: string) => void;
  onAnnotationChange?: (annotationId: string, note: string) => void;
  onAnnotationRemove?: (annotationId: string) => void;
  /** Jumps the workspace to the annotated object and flashes a highlight. */
  onAnnotationLocate?: (annotationId: string) => void;
}

export interface ChatInputHandle {
  focus: () => void;
}

interface LocalAudioConfig {
  asr: {
    enabled: boolean;
    ready: boolean;
    provider: string;
    base_url: string | null;
    model: string;
    setup?: {
      provider: string;
      runtime?: "builtin-rpc" | "provider-route";
      status: "disabled" | "needs-install" | "ready";
    };
  };
}

interface VoiceConfigCacheEntry {
  promise: Promise<LocalAudioConfig>;
  expiresAt: number;
  value?: LocalAudioConfig;
}

const voiceConfigCacheByFetch = new WeakMap<
  typeof fetch,
  Map<string, VoiceConfigCacheEntry>
>();
const VOICE_CONFIG_READY_CACHE_TTL_MS = 30_000;
const VOICE_CONFIG_UNAVAILABLE_CACHE_TTL_MS = 1_000;

function voiceConfigNotice(config?: LocalAudioConfig): VoiceInputNotice {
  if (!config || !config.asr.enabled) {
    return {
      message: "Enable voice input in Voice input settings first.",
      action: { label: "Open Voice input", href: "/settings?section=audio" },
    };
  }
  return {
    message: "Deploy the selected ASR model in Models first.",
    action: { label: "Open Models", href: "/settings?section=models" },
  };
}

function voiceTranscriptionNotice(error: unknown): VoiceInputNotice {
  const message = error instanceof Error ? error.message : String(error);
  if (/Local ASR is not enabled/i.test(message)) return voiceConfigNotice();
  if (/Selected ASR model is not deployed/i.test(message))
    return voiceConfigNotice({
      asr: {
        enabled: true,
        ready: false,
        provider: "builtin-funasr",
        base_url: null,
        model: "",
      },
    });
  return { message };
}

async function loadLocalAudioConfig(): Promise<LocalAudioConfig> {
  const fetchImpl = globalThis.fetch;
  const url = runtimeApiUrl("/api/v1/local/audio/voice-input");
  let cache = voiceConfigCacheByFetch.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    voiceConfigCacheByFetch.set(fetchImpl, cache);
  }

  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const request = fetchImpl(url, { credentials: "include" }).then(
    async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as LocalAudioConfig;
    },
  );
  const entry: VoiceConfigCacheEntry = {
    promise: request,
    expiresAt: Number.POSITIVE_INFINITY,
  };
  cache.set(url, entry);
  void request.then(
    (config) => {
      if (cache?.get(url) === entry) {
        entry.value = config;
        entry.expiresAt =
          Date.now() +
          (config.asr.enabled && config.asr.ready
            ? VOICE_CONFIG_READY_CACHE_TTL_MS
            : VOICE_CONFIG_UNAVAILABLE_CACHE_TTL_MS);
      }
    },
    () => {
      if (cache?.get(url) === entry) cache.delete(url);
    },
  );
  return request;
}

function peekLocalAudioConfig(): LocalAudioConfig | undefined {
  const fetchImpl = globalThis.fetch;
  const url = runtimeApiUrl("/api/v1/local/audio/voice-input");
  const cached = voiceConfigCacheByFetch.get(fetchImpl)?.get(url);
  if (!cached || cached.expiresAt <= Date.now()) return undefined;
  return cached.value;
}

async function transcribeLocalAudio(blob: Blob): Promise<string> {
  const type = blob.type || "audio/webm";
  const form = new FormData();
  form.append("file", new File([blob], `voice-${Date.now()}.webm`, { type }));
  const res = await fetch(runtimeApiUrl("/api/v1/local/audio/transcriptions"), {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const json = (await res.json().catch(() => null)) as {
    text?: string;
    error?: string;
  } | null;
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  if (!json?.text) throw new Error("Local ASR returned no transcript");
  return json.text;
}

async function warmupLocalVoiceInput(): Promise<void> {
  const res = await fetch(
    runtimeApiUrl("/api/v1/local/audio/voice-input/warmup"),
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── Helpers ─────────────────────────────────────────────────

function classifyFile(file: File): UploadedAttachment["type"] | undefined {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return undefined;
}

const PROJECT_ASSET_MARKER_PREFIX = "clash-project-asset:";

function projectAssetMarker(assetId: string): string {
  return `${PROJECT_ASSET_MARKER_PREFIX}${encodeURIComponent(assetId)}`;
}

function projectAssetIdFromMarker(encodedAssetId: string): string | undefined {
  try {
    const assetId = decodeURIComponent(encodedAssetId);
    return assetId || undefined;
  } catch {
    return undefined;
  }
}

/** Extract stable Project Asset identities from composer markdown. */
function extractAssetKeys(markdown: string): UploadedAttachment[] {
  const results: UploadedAttachment[] = [];
  const seen = new Set<string>();
  const addProjectAsset = (
    fileName: string,
    url: string,
    type: "image" | "video" | "audio",
    encodedAssetId: string | undefined,
  ) => {
    if (!encodedAssetId) return;
    const assetId = projectAssetIdFromMarker(encodedAssetId);
    if (!assetId || seen.has(assetId)) return;
    seen.add(assetId);
    results.push({ id: assetId, assetId, fileName, fileType: "", type, url });
  };
  for (const match of markdown.matchAll(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"clash-project-asset:([^"]+)")?\)/g,
  )) {
    addProjectAsset(match[1] || "image", match[2], "image", match[3]);
  }
  for (const match of markdown.matchAll(
    /\[(🎬|🔊)\s+([^\]]+)\]\(([^)\s]+)(?:\s+"clash-project-asset:([^"]+)")?\)/g,
  )) {
    addProjectAsset(
      match[2],
      match[3],
      match[1] === "🎬" ? "video" : "audio",
      match[4],
    );
  }

  return results;
}

/** Convert inline mention images ![mention:nodeId:label](url) back to @[label](node:id) */
function restoreMentions(markdown: string): string {
  return markdown.replace(
    /!\[mention:([^:]+):([^\]]*)\]\([^)]*\)/g,
    (_match, nodeId, label) => {
      return `@[${label}](node:${nodeId})`;
    },
  );
}

const DROPZONE_ACCEPT = {
  "image/*": [],
  "video/*": [],
  "audio/*": [],
} satisfies Accept;

// ─── Component ───────────────────────────────────────────────

function ChatInputInner(
  {
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
    placeholder = "Ask anything...",
    variant = "default",
    mentionableNodes,
    connectedNodeIds,
    onMentionAdded,
    projectId,
    toolbarAccessory,
    rightToolbarAccessory,
    onCaretTargetChange,
    annotationBlocks = [],
    onAnnotationOpen,
    onAnnotationChange,
    onAnnotationRemove,
    onAnnotationLocate,
  }: ChatInputProps,
  ref: ForwardedRef<ChatInputHandle>,
) {
  const { t } = useTranslation();
  const editorRef = useRef<MilkdownEditorHandle>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const [uploading, setUploading] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editorRef.current?.focus();
      },
    }),
    [],
  );

  // ─── File upload → insert into editor on complete ──────────
  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      if (!projectId) return;
      Array.from(files).forEach(async (file) => {
        const type = classifyFile(file);
        if (!type) return;
        const name = file.name;

        setUploading((n) => n + 1);
        try {
          let md: string;
          const asset = await importProjectAssetFile(projectId, file, {
            kind: type,
          });
          if (!asset.url)
            throw new Error("Imported Project Asset is not locally available");
          const marker = projectAssetMarker(asset.id);
          if (type === "image") md = `![${name}](${asset.url} "${marker}")`;
          else if (type === "video")
            md = `[🎬 ${name}](${asset.url} "${marker}")`;
          else md = `[🔊 ${name}](${asset.url} "${marker}")`;
          editorRef.current?.insertAtCursor(md + " ");
        } catch (err) {
          console.error("[ChatInput] upload failed:", err);
          editorRef.current?.insertAtCursor(
            t("copilot.chatInput.uploadFailed", { name }),
          );
        } finally {
          setUploading((n) => n - 1);
        }
      });
    },
    [projectId, t],
  );

  const actionLocked = isCreatingSession || disabled;
  const attachmentsEnabled = Boolean(projectId);
  const submitLocked =
    actionLocked || (isProcessing && !allowSubmitWhileProcessing);
  const hasAnnotationContent = annotationBlocks.some(
    (annotation) =>
      annotation.note.trim() || annotation.target.selection?.exact.trim(),
  );
  const canSend =
    Boolean(input.trim() || hasAnnotationContent) &&
    !submitLocked &&
    uploading === 0;
  const showQueuedSend = isProcessing && allowSubmitWhileProcessing && canSend;
  const isHero = variant === "hero";

  // ─── Submit ──────────────────────────────────────────────
  const handleFormSubmit = useCallback(() => {
    const raw = input.trim();
    if ((!raw && !hasAnnotationContent) || uploading > 0 || submitLocked)
      return;
    const text = restoreMentions(raw);
    const attachments = extractAssetKeys(text);
    onInputChange("");
    editorRef.current?.clear();
    onCaretTargetChange?.(null);
    onSubmit(text, attachments, annotationBlocks);
  }, [
    annotationBlocks,
    hasAnnotationContent,
    input,
    onCaretTargetChange,
    onInputChange,
    onSubmit,
    submitLocked,
    uploading,
  ]);

  const updateCaretTarget = useCallback(() => {
    if (!onCaretTargetChange) return;
    const host = editorHostRef.current;
    const selection = document.getSelection?.();
    if (
      !host ||
      !selection ||
      selection.rangeCount === 0 ||
      !selection.isCollapsed
    ) {
      onCaretTargetChange(null);
      return;
    }

    const anchor = selection.anchorNode;
    const anchorElement =
      anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentNode;
    if (!anchorElement || !host.contains(anchorElement)) {
      onCaretTargetChange(null);
      return;
    }

    const range = selection.getRangeAt(0).cloneRange();
    let rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      const marker = document.createElement("span");
      marker.textContent = "\u200b";
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
  const [isCheckingVoice, setIsCheckingVoice] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<VoiceInputNotice | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [voiceCompletionIntent, setVoiceCompletionIntent] =
    useState<SpeechInputCompletionIntent | null>(null);
  const voiceAttemptRef = useRef(0);
  const getLocalAudioConfig = useCallback(() => loadLocalAudioConfig(), []);

  useEffect(() => {
    void getLocalAudioConfig().catch(() => undefined);
  }, [getLocalAudioConfig]);

  const startListening = useCallback(() => {
    if (isCheckingVoice || isListening) return;
    setVoiceNotice(null);
    const cachedConfig = peekLocalAudioConfig();
    if (
      cachedConfig &&
      (!cachedConfig.asr.enabled || !cachedConfig.asr.ready)
    ) {
      setVoiceNotice(voiceConfigNotice(cachedConfig));
      return;
    }

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceNotice({
        message: "Local microphone recording is unavailable in this browser.",
      });
      return;
    }

    const attempt = voiceAttemptRef.current + 1;
    voiceAttemptRef.current = attempt;
    setRecordingElapsedSeconds(0);
    setVoiceCompletionIntent(null);
    setIsListening(true);
    setIsCheckingVoice(true);

    // Readiness was prefetched when the composer mounted. A cold or slow
    // request must not sit in front of microphone startup, so validate it
    // in parallel and only interrupt this exact attempt if it is unusable.
    void getLocalAudioConfig()
      .then(
        (audioConfig) => {
          if (voiceAttemptRef.current !== attempt) return;
          if (!audioConfig.asr.enabled || !audioConfig.asr.ready) {
            setIsCheckingVoice(false);
            voiceAttemptRef.current += 1;
            setIsListening(false);
            setVoiceNotice(voiceConfigNotice(audioConfig));
            return;
          }
          if (audioConfig.asr.setup?.runtime === "builtin-rpc") {
            void warmupLocalVoiceInput().catch(() => undefined);
          }
        },
        () => {
          if (voiceAttemptRef.current !== attempt) return;
          setIsCheckingVoice(false);
          voiceAttemptRef.current += 1;
          setIsListening(false);
          setVoiceNotice(voiceConfigNotice());
        },
      )
      .finally(() => {
        if (voiceAttemptRef.current === attempt) setIsCheckingVoice(false);
      });
  }, [getLocalAudioConfig, isCheckingVoice, isListening]);

  const finishVoice = useCallback(
    async (blob: Blob, intent: SpeechInputCompletionIntent) => {
      if (isTranscribing) return;
      voiceAttemptRef.current += 1;
      setVoiceCompletionIntent(intent);
      setIsTranscribing(true);
      setIsListening(false);
      setIsCheckingVoice(false);
      setVoiceNotice(null);
      try {
        if (!blob.size) {
          setVoiceNotice({ message: "No microphone audio was captured." });
          return;
        }
        const text = (await transcribeLocalAudio(blob)).trim();
        if (!text) return;
        const combinedText = input.trim() ? `${input.trim()} ${text}` : text;
        if (intent === "send") {
          const submittedText = restoreMentions(combinedText);
          onInputChange("");
          editorRef.current?.clear();
          onCaretTargetChange?.(null);
          onSubmit(
            submittedText,
            extractAssetKeys(submittedText),
            annotationBlocks,
          );
        } else {
          onInputChange(combinedText);
        }
      } catch (err) {
        setVoiceNotice(voiceTranscriptionNotice(err));
      } finally {
        setIsTranscribing(false);
        setVoiceCompletionIntent(null);
      }
    },
    [
      annotationBlocks,
      input,
      isTranscribing,
      onCaretTargetChange,
      onInputChange,
      onSubmit,
    ],
  );

  const handleRecordingError = useCallback((error: unknown) => {
    voiceAttemptRef.current += 1;
    setIsListening(false);
    setIsCheckingVoice(false);
    setVoiceCompletionIntent(null);
    const message = error instanceof Error ? error.message : String(error);
    setVoiceNotice({
      message: /permission|denied|notallowed/i.test(message)
        ? "Microphone permission is required for local ASR."
        : "Local microphone recording failed.",
    });
  }, []);

  const handleDropAccepted = useCallback(
    (files: File[]) => {
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles],
  );
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    accept: DROPZONE_ACCEPT,
    disabled: actionLocked || !attachmentsEnabled,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: handleDropAccepted,
  });
  const disabledPlaceholder =
    actionLocked && !input.trim() ? placeholder : null;

  return (
    <div className={isHero ? "" : "px-4 pb-4"}>
      <Input
        {...getInputProps({
          "aria-hidden": true,
          tabIndex: -1,
        })}
        className="hidden"
      />

      {/* Error banner */}
      <AnimatePresence>
        {!isHero && error && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="mb-2"
          >
            <Button
              onClick={onDismissError}
              size="sm"
              shape="rounded"
              className="clash-chat-input-alert-error min-h-0 w-full justify-center rounded-lg border-transparent px-3 py-1.5 text-center text-xs font-normal shadow-none focus-visible:ring-brand focus-visible:ring-offset-1"
            >
              {error}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main input card */}
      <div
        {...getRootProps({
          className: `clash-chat-input-surface ${isHero ? "p-2" : ""} ${isDragActive ? "ring-2 ring-brand/40 ring-offset-2 ring-offset-warm-surface" : ""}`,
        })}
      >
        <div className={isHero ? "flex min-h-[142px] flex-col" : ""}>
          <AgentAnnotationTray
            annotations={annotationBlocks}
            disabled={actionLocked}
            onOpen={onAnnotationOpen}
            onChange={onAnnotationChange}
            onRemove={onAnnotationRemove}
            onLocate={onAnnotationLocate}
          />
          <div
            ref={editorHostRef}
            aria-disabled={actionLocked || undefined}
            className={`clash-chat-input-editor relative ${isHero ? "clash-chat-input-editor--hero" : "clash-chat-input-editor--default"} milkdown-chat-input w-full text-left chat-scroll-hidden ${isHero ? "min-h-[100px] flex-1 px-5 pt-4" : "min-h-[52px] max-h-[200px]"} overflow-y-auto ${actionLocked ? "pointer-events-none opacity-60" : ""}`}
            onFocusCapture={() =>
              window.requestAnimationFrame(updateCaretTarget)
            }
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                onCaretTargetChange?.(null);
              }
            }}
            onKeyUp={() => window.requestAnimationFrame(updateCaretTarget)}
            onPointerUp={() => window.requestAnimationFrame(updateCaretTarget)}
            onInput={() => window.requestAnimationFrame(updateCaretTarget)}
          >
            {disabledPlaceholder ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-[18px] py-4 text-sm text-stone-500 dark:text-stone-400">
                {disabledPlaceholder}
              </div>
            ) : null}
            <MilkdownEditor
              ref={editorRef}
              value={input}
              onChange={onInputChange}
              onSubmit={handleFormSubmit}
              promptModalities={["text", "image", "video", "audio"]}
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
              <CircleNotch
                className="w-3 h-3 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span>
                {t("copilot.chatInput.uploading", { count: uploading })}
              </span>
            </div>
          )}

          {/* Bottom toolbar */}
          {isListening || isTranscribing ? (
            <SpeechInputRecording
              elapsedSeconds={recordingElapsedSeconds}
              processingIntent={voiceCompletionIntent}
              regionLabel={t("copilot.chatInput.voice")}
              recordingDurationLabel={t("copilot.chatInput.recordingDuration")}
              stopAndTranscribeLabel={t("copilot.chatInput.stopAndTranscribe")}
              stopTranscribeAndSendLabel={t(
                "copilot.chatInput.stopTranscribeAndSend",
              )}
              onCompletionIntentChange={setVoiceCompletionIntent}
              onRecordingProgress={setRecordingElapsedSeconds}
              onRecordingComplete={(blob, intent) =>
                void finishVoice(blob, intent)
              }
              onRecordingError={handleRecordingError}
              className={isHero ? "px-5" : "px-4"}
              leading={attachmentsEnabled ? (
                <IconButton
                  onClick={open}
                  disabled={actionLocked}
                  label={t("copilot.chatInput.attach")}
                  shape="rounded"
                  icon={<Plus className="h-4 w-4" weight="bold" />}
                  className="-ml-1.5 shrink-0"
                />
              ) : undefined}
            />
          ) : (
            <div
              className={`clash-chat-input-actions clash-chat-input-toolbar-row items-center pb-2.5 pt-1.5 ${isHero ? "px-5" : "px-4"}`}
            >
              <div className="clash-chat-input-toolbar-start flex min-w-0 items-center gap-2">
                {attachmentsEnabled ? (
                  <IconButton
                    onClick={open}
                    disabled={actionLocked}
                    label={t("copilot.chatInput.attach")}
                    shape="rounded"
                    icon={<Plus className="w-4 h-4" weight="bold" />}
                    className="-ml-1.5"
                  />
                ) : null}
                {toolbarAccessory ? (
                  <div className="clash-chat-input-toolbar-accessory min-w-0">
                    {toolbarAccessory}
                  </div>
                ) : null}
              </div>
              <div className="clash-chat-input-toolbar-end -mr-1.5 flex min-w-0 items-center justify-end gap-1.5">
                {rightToolbarAccessory ? (
                  <div className="clash-chat-input-toolbar-config min-w-0">
                    {rightToolbarAccessory}
                  </div>
                ) : null}
                <VoiceInputSetupPopover
                  open={Boolean(voiceNotice)}
                  onOpenChange={(open) => {
                    if (open) {
                      void startListening();
                    } else {
                      setVoiceNotice(null);
                    }
                  }}
                  notice={voiceNotice}
                  trigger={
                    <IconButton
                      disabled={actionLocked || isCheckingVoice}
                      aria-busy={isCheckingVoice}
                      label={t("copilot.chatInput.voice")}
                      shape="rounded"
                      icon={
                        isCheckingVoice ? (
                          <CircleNotch
                            className="w-4 h-4 animate-spin motion-reduce:animate-none"
                            weight="bold"
                          />
                        ) : (
                          <Microphone className="w-4 h-4" weight="bold" />
                        )
                      }
                    />
                  }
                />
                {showQueuedSend ? (
                  <IconButton
                    onClick={handleFormSubmit}
                    disabled={!canSend}
                    label={t("copilot.chatInput.send")}
                    shape="rounded"
                    size="md"
                    className="clash-chat-input-primary w-9 h-9 min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                    icon={<ArrowUp className="w-3.5 h-3.5" weight="bold" />}
                  />
                ) : null}
                {isProcessing && onStop ? (
                  <IconButton
                    onClick={onStop}
                    label={t("copilot.chatInput.stop")}
                    shape="rounded"
                    size="md"
                    className="clash-chat-input-stop w-9 h-9 min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                    icon={
                      <span className="h-2.5 w-2.5 rounded-[3px] bg-current" />
                    }
                  />
                ) : (
                  <IconButton
                    onClick={handleFormSubmit}
                    disabled={!canSend && !isCreatingSession}
                    label={t("copilot.chatInput.send")}
                    aria-busy={isCreatingSession || uploading > 0}
                    shape="rounded"
                    size="md"
                    className={`w-9 h-9 min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface ${
                      isCreatingSession || uploading > 0
                        ? "clash-chat-input-primary focus-visible:ring-brand"
                        : canSend
                          ? "clash-chat-input-primary focus-visible:ring-brand"
                          : "bg-warm-muted text-slate-500 dark:text-slate-500 cursor-not-allowed focus-visible:ring-brand"
                    }`}
                    icon={
                      isCreatingSession || uploading > 0 ? (
                        <CircleNotch className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <ArrowUp className="w-3.5 h-3.5" weight="bold" />
                      )
                    }
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  ChatInputInner,
);
ChatInput.displayName = "ChatInput";
