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
        "text-[13px] leading-[1.55] prose-p:my-1 prose-pre:my-1.5 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5",
        "prose-headings:font-semibold prose-h1:text-base prose-h2:text-base prose-h3:text-sm",
        "prose-code:before:content-none prose-code:after:content-none prose-code:rounded-none prose-code:bg-transparent prose-code:px-0 prose-code:py-0",
        "prose-pre:border-0 prose-pre:bg-transparent prose-pre:p-0",
        "prose-table:my-2 prose-table:text-[13px] prose-th:px-0 prose-th:py-1 prose-td:px-0 prose-td:py-1 prose-td:align-top",
        "prose-a:text-primary hover:prose-a:underline",
        "[&>*]:!mb-0 [&>*]:!mt-0 [&>*+*]:!mt-1.5",
        className,
      )}
      controls={{ code: false, table: false, mermaid: false }}
      linkSafety={{ enabled: false }}
      components={{
        code: ({ node: _node, children, ...rest }) => (
          <code
            {...rest}
            className="rounded-none bg-transparent p-0 font-[inherit] text-inherit"
          >
            {children}
          </code>
        ),
        table: ({ node: _node, children, ...rest }) => (
          <div className="not-prose my-2 overflow-x-auto">
            <table
              {...rest}
              className="w-full border-separate border-spacing-0 text-[13px] leading-[1.45] text-[#05070d] [&_tr]:bg-transparent [&_td]:border-t [&_td]:border-neutral-200/70 [&_td]:px-0 [&_td]:py-1 [&_td]:pr-4 [&_td]:align-top [&_th]:border-b [&_th]:border-neutral-200/80 [&_th]:px-0 [&_th]:py-1 [&_th]:pr-4 [&_th]:text-left [&_th]:font-medium [&_th]:text-neutral-500"
            >
              {children}
            </table>
          </div>
        ),
        pre: ({ node: _node, children, ...rest }) => (
          <pre
            {...rest}
            className="not-prose my-1.5 overflow-x-auto whitespace-pre-wrap bg-transparent p-0 text-[12px] font-mono leading-[1.5] text-neutral-500"
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
