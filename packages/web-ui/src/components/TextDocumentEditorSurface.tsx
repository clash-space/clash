import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Quotes,
  TextB,
  TextH,
  TextItalic,
} from "@phosphor-icons/react";
import type {
  AgentAnnotationDraft,
  AgentAnnotationTarget,
} from "@clash/shared-types";
import { useRevisionHistory } from "@clash/web-ui/hooks/useRevisionHistory";
import MilkdownEditor, {
  type MilkdownEditorHandle,
  type MilkdownFormat,
} from "./MilkdownEditor";
import { RevisionHistoryBadge } from "./nodes/RevisionHistoryBadge";
import {
  AgentSelectionAnnotationOverlay,
  type AgentSelectionAnnotationOverlayHandle,
} from "./copilot/AgentSelectionAnnotationOverlay";
import { handleSelectionAnnotationContextMenu } from "./copilot/selectionAnnotationContextMenu";
import { IconButton } from "./ui/icon-button";
import { Input } from "./ui/input";

const TEXT_AUTOSAVE_DELAY_MS = 500;

interface TextDocumentDraft {
  label: string;
  content: string;
}

function isSameDraft(left: TextDocumentDraft, right: TextDocumentDraft) {
  return left.label === right.label && left.content === right.content;
}

export interface TextDocumentEditorSurfaceProps {
  projectId: string;
  nodeId: string;
  label: string;
  content: string;
  annotationTarget: AgentAnnotationTarget | null;
  annotations: readonly AgentAnnotationDraft[];
  onCreateAnnotation: (target: AgentAnnotationTarget, note: string) => void;
  activeAnnotationId?: string | null;
  onSelectAnnotation?: (annotationId: string) => void;
  onLocateAnnotation?: (annotationId: string) => void;
  onRemoveAnnotation?: (annotationId: string) => void;
  onSave: (next: { label: string; content: string }) => void;
  onClose: () => void;
}

export function TextDocumentEditorSurface({
  projectId,
  nodeId,
  label: sourceLabel,
  content: sourceContent,
  annotationTarget,
  annotations,
  onCreateAnnotation,
  activeAnnotationId = null,
  onSelectAnnotation,
  onLocateAnnotation,
  onRemoveAnnotation,
  onSave,
  onClose,
}: TextDocumentEditorSurfaceProps) {
  const [label, setLabel] = useState(sourceLabel);
  const [content, setContent] = useState(sourceContent);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved">("saved");
  const editorRef = useRef<MilkdownEditorHandle>(null);
  const selectionAnnotationOverlayRef =
    useRef<AgentSelectionAnnotationOverlayHandle>(null);
  const onSaveRef = useRef(onSave);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<TextDocumentDraft>({
    label: sourceLabel,
    content: sourceContent,
  });
  const persistedDraftRef = useRef<TextDocumentDraft>({
    label: sourceLabel,
    content: sourceContent,
  });
  onSaveRef.current = onSave;
  latestDraftRef.current = { label, content };
  const revisionHistory = useRevisionHistory({
    projectId,
    nodeId,
    limit: 20,
  });

  useEffect(() => {
    const incomingDraft = {
      label: sourceLabel,
      content: sourceContent,
    };
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    latestDraftRef.current = incomingDraft;
    persistedDraftRef.current = incomingDraft;
    setLabel(sourceLabel);
    setContent(sourceContent);
    setSaveStatus("saved");
  }, [nodeId, sourceContent, sourceLabel]);

  const persistLatestDraft = useCallback((updateStatus = true) => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const draft = latestDraftRef.current;
    if (isSameDraft(draft, persistedDraftRef.current)) {
      if (updateStatus) setSaveStatus("saved");
      return;
    }
    onSaveRef.current(draft);
    persistedDraftRef.current = draft;
    if (updateStatus) setSaveStatus("saved");
  }, []);

  useEffect(() => {
    const draft = { label, content };
    latestDraftRef.current = draft;
    if (isSameDraft(draft, persistedDraftRef.current)) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("saving");
    autosaveTimerRef.current = setTimeout(() => {
      persistLatestDraft();
    }, TEXT_AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [content, label, persistLatestDraft]);

  useEffect(
    () => () => {
      persistLatestDraft(false);
    },
    [persistLatestDraft],
  );

  const characterCount = Array.from(content).length;
  const lineCount = content.length === 0 ? 1 : content.split(/\r?\n/).length;
  const textAnnotationTarget = useMemo<AgentAnnotationTarget | null>(() => {
    if (!annotationTarget || annotationTarget.surface !== "canvas") return null;
    return {
      ...annotationTarget,
      objectId: nodeId,
      objectType: "canvas-text",
      objectLabel: label || "Untitled",
      objectPath: `canvases/${annotationTarget.surfaceId}/nodes/${nodeId}`,
    };
  }, [annotationTarget, label, nodeId]);

  const handleFormat = useCallback((format: MilkdownFormat) => {
    editorRef.current?.formatSelection(format);
  }, []);

  const handleClose = useCallback(() => {
    persistLatestDraft();
    onClose();
  }, [onClose, persistLatestDraft]);
  const workbenchIconButtonClass =
    "clash-workbench-control-button h-[var(--clash-project-control-height,2rem)] w-[var(--clash-project-control-height,2rem)] min-h-0 min-w-0 shrink-0 text-content-muted hover:bg-warm-hover hover:text-content-primary";

  return (
    <main
      aria-label={`${label || "Untitled"} text editor`}
      className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-warm-page"
    >
      <header
        data-text-editor-region="command-bar"
        className="relative z-20 flex h-[var(--clash-project-sidebar-header-height,2.5rem)] shrink-0 items-center bg-warm-page px-[var(--clash-project-chrome-gutter,0.5rem)]"
      >
        <div
          data-text-editor-command-bar-content=""
          className="clash-project-chrome-header-content flex min-w-0 flex-1 items-center gap-[var(--clash-control-gap,0.25rem)]"
        >
          <IconButton
            label="Back to Canvas"
            title="Back to Canvas"
            onClick={handleClose}
            size="sm"
            shape="rounded"
            className={workbenchIconButtonClass}
            icon={<ArrowLeft className="h-4 w-4" weight="bold" />}
          />
          <span
            className="mx-[var(--clash-control-gap,0.25rem)] h-4 w-px shrink-0 bg-warm-border"
            aria-hidden="true"
          />
          <div
            role="toolbar"
            aria-label="Text formatting"
            className="flex items-center gap-[var(--clash-control-gap,0.25rem)]"
          >
            <IconButton
              label="Bold"
              aria-label="Bold"
              title="Bold"
              size="sm"
              className={workbenchIconButtonClass}
              onClick={() => handleFormat("bold")}
              icon={<TextB className="h-4 w-4" weight="bold" />}
            />
            <IconButton
              label="Italic"
              aria-label="Italic"
              title="Italic"
              size="sm"
              className={workbenchIconButtonClass}
              onClick={() => handleFormat("italic")}
              icon={<TextItalic className="h-4 w-4" />}
            />
            <IconButton
              label="Heading 2"
              aria-label="Heading 2"
              title="Heading 2"
              size="sm"
              className={workbenchIconButtonClass}
              onClick={() => handleFormat("heading-2")}
              icon={<TextH className="h-4 w-4" weight="bold" />}
            />
            <IconButton
              label="Block quote"
              aria-label="Block quote"
              title="Block quote"
              size="sm"
              className={workbenchIconButtonClass}
              onClick={() => handleFormat("blockquote")}
              icon={<Quotes className="h-4 w-4" weight="bold" />}
            />
          </div>

          <span className="ml-auto" aria-hidden="true" />
          <div className="hidden shrink-0 items-center gap-[var(--clash-project-chrome-gutter,0.5rem)] text-xs tabular-nums text-content-muted lg:flex">
            <span>
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
            <span>{characterCount} characters</span>
          </div>
          <RevisionHistoryBadge
            nodeId={nodeId}
            history={revisionHistory}
            className="shrink-0"
            showWhenEmpty
            variant="toolbar"
          />
          <div
            className="flex shrink-0 items-center gap-[var(--clash-control-gap,0.25rem)] text-[11px] text-content-muted"
            aria-live="polite"
          >
            {saveStatus === "saving" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            ) : (
              <Check className="h-3.5 w-3.5" weight="bold" />
            )}
            {saveStatus === "saving" ? "Saving…" : "Saved"}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 bg-warm-page py-[var(--clash-project-chrome-gutter,0.5rem)] pl-[var(--clash-project-chrome-gutter,0.5rem)] pr-0">
        <div className="clash-workbench-panel-surface clash-text-node-editor h-full min-h-0 overflow-y-auto bg-warm-surface">
          <div className="clash-text-node-document mx-auto min-h-full bg-warm-surface">
            <div className="clash-text-node-title-shell">
              <Input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Untitled"
                aria-label="Document title"
                className="clash-text-node-title-input h-auto w-full border-0 bg-transparent p-0 font-display font-bold text-content-primary placeholder:text-content-disabled focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <div
              data-agent-annotation-selection-root=""
              data-agent-annotation-object-id={nodeId}
              data-agent-annotation-object-type="canvas-text"
              data-agent-annotation-object-label={label}
              data-agent-annotation-object-path={
                textAnnotationTarget?.objectPath
              }
              className="relative mx-auto w-[min(100%,var(--clash-document-reading-width))]"
              onContextMenu={(event) => {
                handleSelectionAnnotationContextMenu(
                  event,
                  selectionAnnotationOverlayRef,
                );
              }}
            >
              <MilkdownEditor
                ref={editorRef}
                value={content}
                onChange={setContent}
              />
              <AgentSelectionAnnotationOverlay
                ref={selectionAnnotationOverlayRef}
                target={textAnnotationTarget}
                annotations={annotations}
                onCreate={onCreateAnnotation}
                objectId={nodeId}
                activeId={activeAnnotationId}
                onSelect={onSelectAnnotation}
                onLocate={onLocateAnnotation}
                onRemove={onRemoveAnnotation}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
