import ReactMarkdown from "react-markdown";
import { useMediaViewer } from "../MediaViewerContext";
import { useCanvasFocus } from "../CanvasFocusContext";
import type { MentionableNode } from "../MilkdownEditor";
import { resolveAssetMediaUrl } from "../../features/assets/media-url";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { AgentAnnotationTray } from "./AgentAnnotationBlock";
import { parseUserMessageContent } from "./userMessageContent";

/** Inline thumbnail for a `@[label](node:<id>)` mention. Single click
 *  flies the canvas camera to the referenced asset node (via the
 *  `useCanvasFocus` abstraction); double-click opens the full-screen
 *  MediaViewer. `nodeId` is the canvas node id extracted upstream
 *  from the `mention:<id>:<label>` alt encoding. */
function InlineThumbnail({
  src,
  alt,
  title,
  nodeId,
}: {
  src?: string;
  alt: string;
  title: string;
  nodeId?: string;
}) {
  const { openViewer } = useMediaViewer();
  const { focusNode } = useCanvasFocus();
  const projectedUrl = resolveAssetMediaUrl(src);
  const tooltipLabel = nodeId
    ? `${title} — click to focus, double-click to preview`
    : title;

  return projectedUrl ? (
    <Tooltip label={tooltipLabel}>
      <Button
        aria-label={tooltipLabel}
        size="sm"
        shape="rounded"
        className="mx-0.5 inline-flex h-[1.2em] min-h-0 w-[1.2em] align-text-bottom rounded border-transparent bg-transparent p-0 shadow-none hover:bg-transparent hover:ring-2 hover:ring-slate-400 focus-visible:ring-slate-400 focus-visible:ring-offset-1 dark:hover:ring-slate-500"
        onClick={(e) => {
          // Single click → pan the canvas to this node. Skipped
          // when no nodeId (the chip came from a non-canvas
          // reference) or outside a CanvasFocusProvider (hook
          // returns a no-op). stopPropagation so the click
          // doesn't bubble to the message bubble's own handlers.
          if (!nodeId) return;
          e.stopPropagation();
          focusNode(nodeId);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          openViewer("image", projectedUrl, title);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={projectedUrl}
          alt={alt}
          className="h-full w-full rounded object-cover"
        />
      </Button>
    </Tooltip>
  ) : null;
}

export function UserMessage({
  content,
  mentionNodes,
}: {
  content: string;
  mentionNodes?: MentionableNode[];
}) {
  const { text, annotations } = parseUserMessageContent(content);
  let cleaned = text;

  if (mentionNodes?.length) {
    // Capture nodeId up to first whitespace OR `)` — robust to
    // markdown link `title` attributes that some serializers emit
    // (`[label](node:<id> "title")`), which would otherwise pollute
    // the captured nodeId and break the mentionNodes lookup.
    cleaned = cleaned.replace(
      /@\[([^\]]*)\]\(node:([^\s)]+)(?:\s+"[^"]*")?\)/g,
      (_match, label, nodeId) => {
        const node = mentionNodes.find((n) => n.id === nodeId);
        if (node?.thumbnail) {
          return `![mention:${nodeId}:${label}](${node.thumbnail})`;
        }
        return `\`@${label}\``;
      },
    );
  }

  return (
    <div className="flex w-full justify-end">
      <div className="flex max-w-[min(34rem,72%)] flex-col items-end">
        {annotations.length === 0 && cleaned ? (
          <div
            className="clash-user-message-bubble break-words px-3 py-2"
            data-chat-typography="body"
          >
            <ReactMarkdown
              components={{
                p: ({ children }) => (
                  <p className="mb-1 last:mb-0">
                    {children}
                  </p>
                ),
                img: ({ src, alt }) => {
                  const mentionMatch = alt?.match(/^mention:([^:]+):(.+)$/);
                  const nodeId = mentionMatch ? mentionMatch[1] : undefined;
                  const label = mentionMatch ? mentionMatch[2] : alt || "";
                  const imgSrc = typeof src === "string" ? src : undefined;
                  return (
                    <InlineThumbnail
                      src={imgSrc}
                      alt={label}
                      title={label}
                      nodeId={nodeId}
                    />
                  );
                },
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="rounded-sm text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {cleaned}
            </ReactMarkdown>
          </div>
        ) : null}
        {annotations.length > 0 ? (
          <div
            data-testid="user-message-annotations"
            className="mt-1.5 self-end"
          >
            <AgentAnnotationTray annotations={annotations} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
