"use client";

// Tool — compact tool-call card tuned for narrow chat panels. We
// started from vercel/ai-elements' tool.tsx verbatim but the upstream
// design (rounded card with prominent INPUT / OUTPUT section headers
// and Badge state pill) eats too much vertical space when chat panels
// stack tens of tool calls per turn. This rewrite keeps the same
// component API (Tool / ToolHeader / ToolContent / ToolInput /
// ToolOutput) but with a flatter visual:
//
//   • Header row: small status dot + tool name + truncated input
//     preview + status text + chevron — all one line.
//   • Body (collapsed by default): full input + output as small mono
//     code blocks, no big "INPUT" / "OUTPUT" labels.
//
// Status colour comes from the shared status-* tokens so it matches
// the agent-list dots in the rest of the panel.

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Button } from "../ui/button";
import { cn } from "./utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "group not-prose w-full rounded-md border border-border bg-card",
      className,
    )}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

// Aligned with agent status-dot palette:
//   green  "live"    — actively streaming / running
//   amber  "linked"  — waiting for approval / connected but idle
//   empty  "offline" — gone / never started
//   red    overlay — failure (output-error / output-denied)
const STATUS_DOT: Record<ToolPart["state"], string> = {
  "approval-requested": "bg-status-busy",
  "approval-responded": "bg-status-busy",
  "input-available": "bg-status-ready animate-pulse",
  "input-streaming": "border border-status-down/40 bg-transparent",
  "output-available": "bg-status-ready",
  "output-denied": "bg-status-down",
  "output-error": "bg-status-down",
};

const STATUS_LABEL: Record<ToolPart["state"], string> = {
  "approval-requested": "awaiting approval",
  "approval-responded": "responded",
  "input-available": "running",
  "input-streaming": "queued",
  "output-available": "done",
  "output-denied": "denied",
  "output-error": "failed",
};

/** Best-effort one-liner of input for the header. */
function inputPreview(input: ToolPart["input"]): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const candidate =
      (typeof o.command === "string" && o.command) ||
      (typeof o.file_path === "string" && o.file_path) ||
      (typeof o.path === "string" && o.path) ||
      (typeof o.url === "string" && o.url) ||
      (typeof o.query === "string" && o.query) ||
      (typeof o.prompt === "string" && o.prompt);
    return candidate ? String(candidate) : JSON.stringify(input);
  }
  return String(input);
}

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  previewInput,
  ...props
}: ToolHeaderProps & { previewInput?: unknown }) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  // Long / backtick-wrapped titles are claude-agent-acp's fallback when
  // it doesn't have a proper title — prefer the tool name in that case
  // so the header stays one tidy line. Full title still goes into the
  // body via ToolInput.
  const looksLikeCommand =
    typeof title === "string" &&
    (title.length > 48 || (title.startsWith("`") && title.endsWith("`")));
  const headerLabel = title && !looksLikeCommand ? title : derivedName;
  const preview = inputPreview(previewInput as ToolPart["input"]);

  return (
    <CollapsibleTrigger asChild {...props}>
      <Button
        size="sm"
        shape="rounded"
        className={cn(
          "min-h-0 w-full justify-start gap-2 border-transparent bg-transparent px-2.5 py-1.5 text-xs shadow-none",
          "rounded-md transition-colors hover:bg-muted/40",
          "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
          className,
        )}
      >
        <span
          aria-label={STATUS_LABEL[state]}
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[state])}
        />
        <span className="font-medium text-foreground shrink-0">{headerLabel}</span>
        {preview && (
          <span className="truncate text-muted-foreground font-mono text-[11px] flex-1 text-left min-w-0">
            {preview}
          </span>
        )}
        {!preview && (
          <span className="flex-1 text-left text-muted-foreground text-[10px] uppercase tracking-wide">
            {STATUS_LABEL[state]}
          </span>
        )}
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </Button>
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:animate-out data-[state=open]:animate-in",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "border-t border-border/60 p-2 space-y-1.5",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

function formatInputForDisplay(input: unknown): { code: string; language: string } {
  if (typeof input === "string") return { code: input, language: "bash" };
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const cmd =
      (typeof o.command === "string" && o.command) ||
      (typeof o.file_path === "string" && o.file_path) ||
      (typeof o.path === "string" && o.path) ||
      (typeof o.prompt === "string" && o.prompt);
    if (cmd) return { code: String(cmd), language: typeof o.command === "string" ? "bash" : "text" };
    return { code: JSON.stringify(input, null, 2), language: "json" };
  }
  return { code: String(input ?? ""), language: "text" };
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  const { code, language } = formatInputForDisplay(input);
  if (!code) return null;
  return (
    <div className={cn("overflow-hidden", className)} {...props}>
      <CodeBlock code={code} language={language} className="bg-muted/50" />
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

function formatOutputForDisplay(output: unknown): string {
  let s: string;
  if (typeof output === "string") s = output;
  else if (Array.isArray(output)) {
    s = output
      .map((c) => {
        const cb = c as { type?: string; text?: string; content?: unknown };
        if (cb?.type === "text" && typeof cb.text === "string") return cb.text;
        if (cb?.content && typeof cb.content === "object") {
          const inner = cb.content as { text?: string };
          if (typeof inner.text === "string") return inner.text;
        }
        if (typeof cb?.content === "string") return cb.content;
        return JSON.stringify(cb, null, 2);
      })
      .join("\n");
  } else if (output && typeof output === "object") {
    const o = output as { text?: string; content?: unknown };
    if (typeof o.text === "string") s = o.text;
    else if (typeof o.content === "string") s = o.content;
    else if (Array.isArray(o.content)) s = formatOutputForDisplay(o.content);
    else s = JSON.stringify(output, null, 2);
  } else s = String(output ?? "");
  const trimmed = s.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const inner = trimmed.slice(3, -3);
    const newline = inner.indexOf("\n");
    if (newline >= 0 && /^[a-z0-9_-]*$/i.test(inner.slice(0, newline).trim())) {
      return inner.slice(newline + 1).trim();
    }
    return inner.trim();
  }
  return s;
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) return null;
  const display = errorText ? String(errorText) : formatOutputForDisplay(output);
  if (!display) return null;
  const isError = !!errorText;
  return (
    <div className={cn("overflow-hidden", className)} {...props}>
      <CodeBlock
        code={display}
        language="text"
        className={cn(isError ? "bg-destructive/10 text-destructive" : "bg-muted/50")}
      />
    </div>
  );
};
