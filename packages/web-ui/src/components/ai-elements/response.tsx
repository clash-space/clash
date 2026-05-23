"use client";

// Response — assistant text renderer. Wraps Streamdown with prose +
// shadcn theme tuning so GFM markdown (tables / code / lists /
// headings / links) renders consistently across the app.
//
// Critical narrow-panel fix: the chat panel is ~400px wide; a default
// `<table>` from markdown overflows horizontally and visually
// collapses into a stack of vertically-aligned cells. We pass a
// `components` override that wraps every `<table>` in an
// `overflow-x-auto` div so wide tables scroll instead of breaking
// layout. Same trick for `<pre>` (long code lines).

import { Streamdown } from "streamdown";
import type { ComponentProps } from "react";
import { cn } from "./utils";

export type ResponseProps = ComponentProps<typeof Streamdown>;

export function Response({ className, components, ...props }: ResponseProps) {
  return (
    <Streamdown
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-p:my-2 prose-pre:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        "prose-headings:font-semibold prose-h1:text-base prose-h2:text-base prose-h3:text-sm",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:border prose-pre:border-border",
        "prose-table:my-3 prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-td:align-top",
        "prose-a:text-primary hover:prose-a:underline",
        className,
      )}
      components={{
        table: ({ node: _node, children, ...rest }) => (
          <div className="not-prose my-3 overflow-x-auto rounded-md border border-border bg-card">
            <table
              {...rest}
              className="w-full border-collapse text-xs [&_tr]:bg-card [&_tr:nth-child(even)]:bg-muted/30 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_td]:border-b [&_td]:border-border [&_tr:last-child_td]:border-b-0 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:border-b [&_th]:border-border [&_th]:bg-muted"
            >
              {children}
            </table>
          </div>
        ),
        pre: ({ node: _node, children, ...rest }) => (
          <pre
            {...rest}
            className="not-prose my-2 overflow-x-auto rounded-md border border-border bg-muted p-3 text-[11px] font-mono leading-relaxed"
          >
            {children}
          </pre>
        ),
        ...components,
      }}
      {...props}
    />
  );
}
