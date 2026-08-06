import { useMemo, useRef } from "react";
import { ArrowSquareOut, TextT, X } from "@phosphor-icons/react";
import type {
  AgentAnnotationDraft,
  AgentAnnotationTarget,
} from "@clash/shared-types";
import ReactMarkdown from "react-markdown";

import {
  AgentSelectionAnnotationOverlay,
  type AgentSelectionAnnotationOverlayHandle,
} from "./copilot/AgentSelectionAnnotationOverlay";
import { handleSelectionAnnotationContextMenu } from "./copilot/selectionAnnotationContextMenu";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { IconButton } from "./ui/icon-button";

export interface TextNodePreviewDialogProps {
  open: boolean;
  nodeId: string;
  label: string;
  content: string;
  annotationTarget: AgentAnnotationTarget | null;
  annotations: readonly AgentAnnotationDraft[];
  portalContainer?: HTMLElement | null;
  onCreateAnnotation: (target: AgentAnnotationTarget, note: string) => void;
  activeAnnotationId?: string | null;
  onSelectAnnotation?: (annotationId: string) => void;
  onLocateAnnotation?: (annotationId: string) => void;
  onRemoveAnnotation?: (annotationId: string) => void;
  onClose: () => void;
  onOpenEditor: () => void;
}

export function TextNodePreviewDialog({
  open,
  nodeId,
  label,
  content,
  annotationTarget,
  annotations,
  portalContainer,
  onCreateAnnotation,
  activeAnnotationId = null,
  onSelectAnnotation,
  onLocateAnnotation,
  onRemoveAnnotation,
  onClose,
  onOpenEditor,
}: TextNodePreviewDialogProps) {
  const annotationOverlayRef =
    useRef<AgentSelectionAnnotationOverlayHandle>(null);
  const textAnnotationTarget = useMemo<AgentAnnotationTarget | null>(() => {
    if (!annotationTarget || annotationTarget.surface !== "canvas") return null;
    return {
      ...annotationTarget,
      objectId: nodeId,
      objectType: "canvas-text",
      objectLabel: label || "Untitled text",
      objectPath: `canvases/${annotationTarget.surfaceId}/nodes/${nodeId}`,
    };
  }, [annotationTarget, label, nodeId]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={`${label || "Untitled text"} preview`}
      size="auto"
      portalContainer={portalContainer}
      overlayClassName="!absolute"
      containerClassName="!absolute"
      contentClassName="clash-workbench-panel-surface flex h-[min(42rem,calc(100vh-5rem))] w-[min(48rem,calc(100vw-3rem))] max-w-none flex-col overflow-hidden bg-warm-surface shadow-2xl"
      hideCloseButton
      unstyled
    >
      <div data-text-node-preview-dialog="" className="contents">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warm-muted text-content-muted">
            <TextT className="h-4 w-4" weight="bold" />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-content-primary">
            {label || "Untitled text"}
          </h2>
          <Button
            variant={null}
            size={null}
            shape={null}
            onClick={onOpenEditor}
            className="clash-workbench-control-button h-[var(--clash-project-control-height,2rem)] min-h-0 shrink-0 px-2.5 text-xs text-content-secondary hover:text-content-primary"
            leftIcon={<ArrowSquareOut className="h-3.5 w-3.5" weight="bold" />}
          >
            Open editor
          </Button>
          <IconButton
            label="Close preview"
            title="Close preview"
            onClick={onClose}
            size="sm"
            shape="rounded"
            className="clash-workbench-control-button h-[var(--clash-project-control-height,2rem)] w-[var(--clash-project-control-height,2rem)] min-h-0 min-w-0 text-content-muted hover:text-content-primary"
            icon={<X className="h-4 w-4" weight="bold" />}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-5">
          <div
            data-agent-annotation-selection-root=""
            data-agent-annotation-object-id={nodeId}
            data-agent-annotation-object-type="canvas-text"
            data-agent-annotation-object-label={label}
            data-agent-annotation-object-path={textAnnotationTarget?.objectPath}
            className="relative mx-auto w-[min(100%,var(--clash-document-reading-width))] select-text"
            onContextMenu={(event) => {
              handleSelectionAnnotationContextMenu(event, annotationOverlayRef);
            }}
          >
            <div className="prose max-w-none text-[length:var(--clash-document-body-size)] leading-[var(--clash-document-body-leading)] prose-slate prose-headings:font-display prose-headings:text-content-primary prose-p:leading-[var(--clash-document-body-leading)] prose-p:text-content-secondary prose-li:leading-[var(--clash-document-body-leading)] prose-li:text-content-secondary prose-a:text-content-primary prose-a:underline prose-code:rounded prose-code:bg-warm-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-content-secondary dark:prose-invert">
              <ReactMarkdown>{content || "No content yet."}</ReactMarkdown>
            </div>
            <AgentSelectionAnnotationOverlay
              ref={annotationOverlayRef}
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
    </Dialog>
  );
}
