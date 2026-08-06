import { useMemo } from 'react';
import { NotePencil, Paperclip } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import { parseUserMessageContent } from './userMessageContent';

export function parseRuntimePromptQueueContent(content: string) {
    return parseUserMessageContent(content);
}

/**
 * Compact presentation for a queued runtime prompt.
 *
 * Runtime transport remains text-compatible with ACP, while this component is
 * the single product boundary that restores Clash-owned structured formats.
 * Add future queued content formats here instead of branching in queue chrome.
 */
export function RuntimePromptQueueContent({ content }: { content: string }) {
    const queuedContent = useMemo(
        () => parseRuntimePromptQueueContent(content),
        [content],
    );
    const firstAnnotation = queuedContent.annotations[0] ?? null;

    return (
        <div
            role="group"
            aria-label="Queued prompt content"
            className="min-w-0 flex-1"
        >
            {queuedContent.text ? (
                <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[13px] font-medium leading-5 text-stone-700 dark:text-stone-200">
                    <ReactMarkdown
                        // Queue rows render both links and images as inert product chips.
                        // Keep Clash's internal `node:` references intact so the mention
                        // renderer can distinguish them from ordinary links.
                        urlTransform={(url) => url}
                        components={{
                            p: ({ children }) => <span className="contents">{children}</span>,
                            a: ({ href, children }) => (
                                <span className="inline-flex shrink-0 items-center rounded bg-warm-muted px-1.5 text-[11px] text-content-primary">
                                    {href?.startsWith('node:') ? '@' : ''}{children}
                                </span>
                            ),
                            img: ({ alt }) => (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-warm-muted px-1.5 text-[11px] text-content-primary">
                                    <Paperclip className="h-3 w-3" aria-hidden="true" />
                                    {alt || 'Attachment'}
                                </span>
                            ),
                        }}
                    >
                        {queuedContent.text}
                    </ReactMarkdown>
                </div>
            ) : null}
            {firstAnnotation ? (
                <div
                    data-testid="queued-agent-annotation-summary"
                    className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-content-secondary"
                >
                    <NotePencil className="h-3.5 w-3.5 shrink-0" weight="duotone" aria-hidden="true" />
                    <span className="truncate font-medium text-content-primary">
                        {firstAnnotation.target.objectLabel}
                    </span>
                    <span className="shrink-0">
                        {queuedContent.annotations.length} {queuedContent.annotations.length === 1 ? 'annotation' : 'annotations'}
                    </span>
                </div>
            ) : null}
        </div>
    );
}
