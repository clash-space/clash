import { memo, useState, useCallback, useEffect } from "react";
import { Handle, Position, NodeProps, Node, useReactFlow } from "@xyflow/react";
import { Spinner, X } from "@phosphor-icons/react";
import MilkdownEditor from "../MilkdownEditor";
import ReactMarkdown from "react-markdown";
import { useOptionalLoroSyncContext } from "../LoroSyncContext";
import DraftPlaceholder from "./DraftPlaceholder";
import SourceHandleMenu from "./SourceHandleMenu";
import { normalizeStatus } from "@clash/web-ui/lib/assetStatus";
import { NodeModalDialog } from "./NodeModalDialog";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";

const TextNode = ({
  data,
  selected,
  id,
}: NodeProps<Node<Record<string, any>>>) => {
  const [showModal, setShowModal] = useState(false);
  const [label, setLabel] = useState(data.label || "Text Node");
  const [content, setContent] = useState(
    data.content ?? "# Hello World\nDouble click to edit.",
  );
  const { setNodes } = useReactFlow();
  const loroSync = useOptionalLoroSyncContext();

  // Sync when data changes (from Loro or other sources)
  useEffect(() => {
    setLabel((prev: string) =>
      data.label && data.label !== prev ? data.label : prev,
    );
    setContent((prev: string) =>
      data.content !== undefined && data.content !== prev ? data.content : prev,
    );
  }, [data.label, data.content]);

  const handleDoubleClick = useCallback(() => {
    setShowModal(true);
  }, []);

  const handleSave = useCallback(() => {
    setShowModal(false);
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, label, content } };
        }
        return node;
      }),
    );
    // Sync to Loro
    if (loroSync?.connected) {
      loroSync.updateNode(id, { data: { label, content } });
    }
  }, [id, label, content, setNodes, loroSync]);

  const handleCancel = useCallback(() => {
    setShowModal(false);
    setLabel(data.label || "Text Node");
    setContent(data.content ?? "# Hello World\nDouble click to edit.");
  }, [data.label, data.content]);

  const handleLabelChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = evt.target.value;
    setLabel(newLabel);
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, label: newLabel } };
        }
        return node;
      }),
    );
    if (loroSync?.connected) {
      loroSync.updateNode(id, { data: { label: newLabel } });
    }
  };

  const normalizedStatus = data.status
    ? normalizeStatus(data.status as string | undefined)
    : null;

  const modalContent = (
    <NodeModalDialog
      open={showModal}
      onClose={handleCancel}
      ariaLabel={`Edit ${label || "text node"}`}
    >
      {/* Header with Title Input */}
      <div className="px-12 pt-8 pb-2 flex justify-between items-start">
        <Input
          type="text"
          value={label}
          onChange={handleLabelChange}
          placeholder="Untitled"
          className="w-full text-4xl font-bold font-display tracking-tight text-slate-900 dark:text-slate-50 placeholder:text-stone-300 bg-transparent border-none outline-none focus:outline-none"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            className="clash-node-primary rounded-lg px-4 py-2 text-sm"
          >
            Save
          </Button>
          <IconButton
            label="Cancel edit"
            onClick={handleCancel}
            className="rounded-lg text-slate-700 hover:bg-warm-hover hover:text-slate-950 dark:text-slate-300"
            icon={<X className="w-5 h-5" weight="bold" />}
          />
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto bg-warm-surface">
        <MilkdownEditor value={content} onChange={setContent} />
      </div>
    </NodeModalDialog>
  );

  return (
    <>
      <div
        className="group relative w-[300px] h-[400px]"
        onDoubleClick={handleDoubleClick}
      >
        {/* Floating Title Input */}
        <div
          className="absolute -top-8 left-4 z-10"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Input
            className="bg-transparent text-lg font-bold font-display text-slate-700 dark:text-slate-300 focus:text-slate-900 focus:outline-none"
            value={label}
            onChange={handleLabelChange}
            placeholder="Text Node"
          />
        </div>

        {/* Main Card */}
        <div
          className={`w-full h-full bg-warm-muted rounded-matrix flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg ${
            selected
              ? "ring-4 ring-brand ring-offset-2"
              : "ring-1 ring-warm-border"
          }`}
        >
          {normalizedStatus === "draft" ? (
            <DraftPlaceholder nodeId={id} modality="text" />
          ) : normalizedStatus === "generating" ? (
            <div className="flex-1 p-8 flex items-center justify-center text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Spinner size={18} className="animate-spin" />
                Generating text...
              </div>
            </div>
          ) : (
            <div className="flex-1 p-8 flex flex-col relative">
              {/* Content Preview with Fade Out */}
              <div className="flex-1 relative overflow-hidden">
                <div
                  className="absolute inset-0"
                  style={{
                    maskImage:
                      "linear-gradient(to bottom, black 60%, transparent 100%)",
                  }}
                >
                  <div className="prose prose-slate prose-p:text-slate-700 prose-headings:text-slate-900">
                    <MarkdownPreview content={content} />
                  </div>
                </div>

                {/* Fade out gradient overlay */}
                <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-warm-muted to-transparent pointer-events-none" />
              </div>
            </div>
          )}
        </div>

        {/* Handle — consistent with ImageNode/other nodes */}
        <Handle
          type="target"
          position={Position.Left}
          style={{
            left: -8,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 100,
          }}
          className="!h-4 !w-4 !border-4 !border-warm-surface !bg-stone-400 transition-all hover:scale-125 shadow-sm hover:!bg-brand"
        />
        <SourceHandleMenu nodeId={id} sourceType="text" />
      </div>

      {modalContent}
    </>
  );
};

// Simple markdown preview component
const MarkdownPreview = ({ content }: { content: string }) => {
  return (
    <div className="prose prose-lg max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-700 prose-a:text-slate-900 prose-a:underline prose-code:text-slate-700 prose-code:bg-warm-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
};

export default memo(TextNode);
