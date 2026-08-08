import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Code, FilmStrip, FloppyDisk, Plus, X } from "@phosphor-icons/react";
import { Player } from "@remotion/player";
import { RemotionSourceComposition } from "@master-clash/remotion-components";

import { appendRemotionComponentToTimelineState } from "@clash/web-ui/lib/remotionComponentTimeline";
import { useOptionalLoroSyncContext } from "../LoroSyncContext";
import { NodeModalDialog } from "./NodeModalDialog";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import { SelectMenu, type SelectOption } from "../ui/select";
import { Textarea } from "../ui/textarea";

export const DEFAULT_REMOTION_COMPONENT_SOURCE = `import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export default function Component() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#171717",
        color: "white",
        fontFamily: "Inter, sans-serif",
        fontSize: 72,
        opacity,
      }}
    >
      Edit this Remotion component
    </AbsoluteFill>
  );
}
`;

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : fallback;
}

function componentValue(data: Record<string, unknown>, id: string) {
  return {
    label: typeof data.label === "string" ? data.label : "Remotion Component",
    componentId: typeof data.componentId === "string" && data.componentId.trim()
      ? data.componentId.trim()
      : id,
    source: typeof data.content === "string" && data.content.trim()
      ? data.content
      : DEFAULT_REMOTION_COMPONENT_SOURCE,
    width: positiveInteger(data.compositionWidth, 720),
    height: positiveInteger(data.compositionHeight, 1280),
    fps: positiveInteger(data.fps, 30),
    durationInFrames: positiveInteger(data.durationInFrames, 120),
  };
}

const RemotionComponentNode = ({
  data,
  selected,
  id,
}: NodeProps<Node<Record<string, unknown>>>) => {
  const loroSync = useOptionalLoroSyncContext();
  const persisted = componentValue(data, id);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState(persisted.label);
  const [draftSource, setDraftSource] = useState(persisted.source);
  const [selectedTimelineId, setSelectedTimelineId] = useState(
    () => loroSync?.timelines[0]?.id ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraftLabel(persisted.label);
    setDraftSource(persisted.source);
  }, [persisted.label, persisted.source]);

  useEffect(() => {
    if (selectedTimelineId && loroSync?.timelines.some((timeline) => timeline.id === selectedTimelineId)) {
      return;
    }
    setSelectedTimelineId(loroSync?.timelines[0]?.id ?? "");
  }, [loroSync?.timelines, selectedTimelineId]);

  const timelineOptions = useMemo<SelectOption<string>[]>(
    () => (loroSync?.timelines ?? []).map((timeline) => ({
      value: timeline.id,
      label: timeline.name,
    })),
    [loroSync?.timelines],
  );

  const saveComponent = useCallback(() => {
    const nextLabel = draftLabel.trim() || "Remotion Component";
    const nextSource = draftSource.trim() ? draftSource : DEFAULT_REMOTION_COMPONENT_SOURCE;
    const ok = loroSync?.updateNode(id, {
      data: {
        label: nextLabel,
        componentId: persisted.componentId,
        content: nextSource,
        compositionWidth: persisted.width,
        compositionHeight: persisted.height,
        fps: persisted.fps,
        durationInFrames: persisted.durationInFrames,
      },
    });
    if (ok === false) {
      setMessage("The component changed concurrently. Reload it and try again.");
      return;
    }
    setMessage(null);
    setEditorOpen(false);
  }, [draftLabel, draftSource, id, loroSync, persisted]);

  const addToTimeline = useCallback(() => {
    const sync = loroSync;
    const timeline = sync?.timelines.find((candidate) => candidate.id === selectedTimelineId);
    if (!sync || !timeline) {
      setMessage("Create or select a Timeline first.");
      return;
    }
    const currentState = timeline.state && typeof timeline.state === "object"
      ? timeline.state as Record<string, unknown>
      : {};
    const nextState = appendRemotionComponentToTimelineState(currentState, {
      nodeId: id,
      componentId: persisted.componentId,
      label: persisted.label,
      durationInFrames: persisted.durationInFrames,
    });
    if (!sync.applyTimelineState(timeline.id, nextState)) {
      setMessage("Timeline changed concurrently. Reopen it and try again.");
      return;
    }
    setMessage(`Added to ${timeline.name}. Future component edits keep this same node reference.`);
  }, [id, loroSync, persisted, selectedTimelineId]);

  const player = (
    <Player
      key={`${persisted.componentId}:${persisted.source}`}
      component={RemotionSourceComposition}
      compositionWidth={persisted.width}
      compositionHeight={persisted.height}
      durationInFrames={persisted.durationInFrames}
      fps={persisted.fps}
      inputProps={{ source: persisted.source, componentId: persisted.componentId }}
      controls
      loop
      style={{ width: "100%", height: "100%" }}
    />
  );

  return (
    <>
      <article
        data-testid="remotion-component-node"
        className={`group relative flex h-[320px] w-[420px] flex-col overflow-hidden rounded-matrix bg-warm-surface shadow-lg ring-1 ring-warm-border ${
          selected ? "ring-4 ring-brand ring-offset-2" : ""
        }`}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-warm-border px-3">
          <FilmStrip className="h-4 w-4 text-brand" weight="duotone" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content-primary">
            {persisted.label}
          </span>
          <Button
            size="sm"
            shape="rounded"
            aria-label="Edit code"
            leftIcon={<Code className="h-3.5 w-3.5" />}
            onClick={() => setEditorOpen(true)}
            className="nodrag h-7 min-h-7 px-2 text-xs"
          >
            Edit code
          </Button>
        </header>
        <div className="nodrag min-h-0 flex-1 bg-black">{player}</div>
        <footer className="nodrag flex min-h-12 items-center gap-2 border-t border-warm-border px-3 py-2">
          <SelectMenu<string>
            ariaLabel="Target Timeline"
            value={selectedTimelineId}
            options={timelineOptions}
            onValueChange={setSelectedTimelineId}
            placeholder="No Timeline"
            variant="field"
            size="sm"
            menuWidth="trigger"
            triggerClassName="h-8 min-h-8 flex-1"
            stopPropagation
          />
          <Button
            size="sm"
            shape="rounded"
            aria-label="Add to Timeline"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            disabled={!selectedTimelineId}
            onClick={addToTimeline}
            className="h-8 min-h-8 whitespace-nowrap px-2.5 text-xs"
          >
            Add to Timeline
          </Button>
        </footer>
        {message ? (
          <p role="status" className="border-t border-warm-border px-3 py-1.5 text-[11px] text-content-secondary">
            {message}
          </p>
        ) : null}
      </article>

      <NodeModalDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        ariaLabel={`Edit ${persisted.label}`}
        contentClassName="max-w-[min(1400px,calc(100vw-4rem))]"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-warm-border px-4">
          <Code className="h-5 w-5 text-brand" weight="duotone" />
          <Input
            aria-label="Component label"
            value={draftLabel}
            onChange={(event) => setDraftLabel(event.target.value)}
            className="min-w-0 flex-1 border-none bg-transparent text-base font-semibold"
          />
          <Button
            size="sm"
            shape="rounded"
            aria-label="Save component"
            leftIcon={<FloppyDisk className="h-4 w-4" />}
            onClick={saveComponent}
          >
            Save
          </Button>
          <IconButton
            label="Close component editor"
            icon={<X className="h-4 w-4" />}
            onClick={() => setEditorOpen(false)}
          />
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-2 bg-warm-page">
          <div className="min-h-0 border-r border-warm-border p-3">
            <Textarea
              aria-label="Remotion TSX source"
              spellCheck={false}
              value={draftSource}
              onChange={(event) => setDraftSource(event.target.value)}
              className="h-full w-full resize-none rounded-matrix border border-warm-border bg-stone-950 p-4 font-mono text-xs leading-5 text-stone-100"
            />
          </div>
          <div className="flex min-h-0 items-center justify-center overflow-hidden bg-stone-950 p-4">
            <div className="aspect-[9/16] max-h-full max-w-full overflow-hidden rounded-matrix bg-black shadow-2xl">
              <Player
                key={`draft:${draftSource}`}
                component={RemotionSourceComposition}
                compositionWidth={persisted.width}
                compositionHeight={persisted.height}
                durationInFrames={persisted.durationInFrames}
                fps={persisted.fps}
                inputProps={{ source: draftSource, componentId: persisted.componentId }}
                controls
                loop
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          </div>
        </div>
      </NodeModalDialog>
    </>
  );
};

export default memo(RemotionComponentNode);
