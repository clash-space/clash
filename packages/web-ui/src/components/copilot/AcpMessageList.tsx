/**
 * Render a stream of ACP-derived messages with the Vercel ai-elements
 * component family — ports of the Response / Message / Plan
 * components live under `../ai-elements/`. This is the
 * single rendering source of truth for every chat surface in the app.
 *
 * Why the upstream components instead of bespoke wrappers: agents
 * emit markdown (tables, headings, bold) that needs proper renderer
 * support; ai-elements is the standard for Vercel AI SDK chats and
 * the visual language people expect.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { AcpToolCallContent, AcpToolCallPart, ByoMessage, PlanEntry } from '@clash/web-ui/lib/acpEvents';
import { EmptyState } from '../../_group-chat/EmptyState';
import {
  Response,
  Message,
  MessageContent,
  Plan,
} from '../ai-elements';
import { cn } from '../ai-elements/utils';
import { CodeBlock } from '../ai-elements/code-block';
import {
  ChevronRight,
  CheckCircle2,
  ListChecks,
  Command,
  SquareTerminal,
  XCircle,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip } from '../ui/tooltip';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';

const ACP_EVENT_ICON_SLOT_CLASS =
  'flex h-5 w-5 shrink-0 items-center justify-center transition-colors group-hover:text-neutral-700';

export interface AcpAgentOutput {
  id: string;
  label: string;
  detail?: string;
  status?: string;
  kind?: string;
}

/**
 * Map claude-agent-acp's `status` string onto Vercel's ToolUIPart
 * `state` enum so the upstream Tool components light up the right
 * status badge + icon without us forking their type system.
 *
 * Heuristic: claude-agent-acp's stream isn't fully reliable — about
 * 5% of tool calls never receive their final `status: completed`
 * update before the turn flushes, so they'd otherwise look "Running"
 * forever even after output is sitting right there. When we have an
 * output (or errorText) but only a non-terminal status, infer the
 * terminal state from the output's shape so the badge matches what
 * the user can already see in the body.
 */
function acpToolContentToOutput(content: AcpToolCallContent[] | undefined): unknown {
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const extracted = content.map((c) => {
    if (c.content && typeof c.content === 'object') {
      const inner = c.content as { text?: string; content?: unknown };
      if (typeof inner.text === 'string') return inner.text;
      if (typeof inner.content === 'string') return inner.content;
    }
    if (typeof c.content === 'string') return c.content;
    if (typeof c.text === 'string') return c.text;
    if (typeof c.output === 'string') return c.output;
    if (typeof c.diff === 'string') return c.diff;
    return c;
  });
  return extracted.every((item) => typeof item === 'string')
    ? extracted.filter(Boolean).join('\n')
    : extracted;
}

function formatUnknown(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

function pickToolVerb(kind: string | undefined, status: string | undefined): string {
  const running = status === 'pending' || status === 'in_progress' || !status;
  switch (kind) {
    case 'permission':
      return running ? '等待授权' : '已授权';
    case 'read':
      return running ? '读取中' : '已读取';
    case 'edit':
      return running ? '编辑中' : '已编辑';
    case 'delete':
      return running ? '删除中' : '已删除';
    case 'move':
      return running ? '移动中' : '已移动';
    case 'search':
    case 'grep':
      return running ? '搜索中' : '已搜索';
    case 'execute':
    case 'terminal':
      return running ? '运行中' : '已运行';
    case 'fetch':
    case 'web':
      return running ? '获取中' : '已获取';
    case 'think':
      return running ? '思考中' : '已思考';
    case 'list':
    case 'tree':
      return running ? '列出中' : '已列出';
    default:
      return running ? '调用中' : '已调用';
  }
}

function pickToolTarget(tool: AcpToolCallPart): string {
  if (tool.title) return tool.title;
  if (tool.locations?.[0]?.path) return shortPath(tool.locations[0].path);
  const raw = tool.rawInput;
  if (raw && typeof raw === 'object') {
    const input = raw as Record<string, unknown>;
    const candidate = input.command ?? input.path ?? input.file_path ?? input.query ?? input.url ?? input.prompt;
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) return candidate.join(' ');
  }
  const output = acpToolContentToOutput(tool.content);
  if (typeof output === 'string') return output.split(/\r?\n/, 1)[0]?.trim() ?? '';
  return '';
}

function toolOutputForBody(tool: AcpToolCallPart): unknown {
  const contentOutput = acpToolContentToOutput(tool.content);
  return contentOutput !== undefined ? contentOutput : tool.rawOutput;
}

type ShellSummary = {
  command: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function shellCommandFromRaw(rawInput: unknown): string | null {
  if (typeof rawInput === 'string' && rawInput.trim()) return rawInput.trim();
  if (!isRecord(rawInput)) return null;
  const command = rawInput.command ?? rawInput.cmd;
  if (typeof command === 'string' && command.trim()) return command.trim();
  if (Array.isArray(command)) {
    const parts = command.filter((part): part is string => typeof part === 'string');
    const lcIndex = parts.findIndex((part) => part === '-lc' || part === '-c');
    const shellCommand = lcIndex >= 0 ? parts[lcIndex + 1] : parts[parts.length - 1];
    return shellCommand?.trim() || parts.join(' ').trim() || null;
  }
  return null;
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isGenericShellToolName(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'exec_command' || normalized === 'shell' || normalized === 'terminal' || normalized === 'bash';
}

function isShellLikeTool(tool: AcpToolCallPart): boolean {
  if (tool.kind === 'execute' || tool.kind === 'terminal') return true;
  if (isGenericShellToolName(tool.title) || isGenericShellToolName(tool.toolName)) return true;
  if (isRecord(tool.rawInput)) {
    const command = tool.rawInput.command ?? tool.rawInput.cmd;
    if (typeof command === 'string' || Array.isArray(command)) return true;
  }
  return Array.isArray(tool.content) && tool.content.some((item) => item.type === 'terminal');
}

function parseShellTextOutput(text: string): Pick<ShellSummary, 'stdout' | 'stderr' | 'exitCode'> {
  const exitCodeMatch = text.match(/Process exited with code\s+(-?\d+)/i);
  const outputMatch = text.match(/(?:^|\n)Output:\s*\n([\s\S]*)$/i);
  return {
    stdout: (outputMatch ? outputMatch[1] : text).trimEnd(),
    exitCode: exitCodeMatch ? Number(exitCodeMatch[1]) : undefined,
  };
}

function shellSummaryForTool(tool: AcpToolCallPart, output: unknown): ShellSummary | null {
  if (!isShellLikeTool(tool)) return null;
  const titleCommand = isGenericShellToolName(tool.title) ? undefined : tool.title;
  const toolNameCommand = isGenericShellToolName(tool.toolName) ? undefined : tool.toolName;
  const command = shellCommandFromRaw(tool.rawInput) ?? titleCommand ?? toolNameCommand;
  if (!command) return null;
  const rawInput = isRecord(tool.rawInput) ? tool.rawInput : {};
  const rawOutput = isRecord(output) ? output : {};
  const parsedTextOutput = typeof output === 'string' ? parseShellTextOutput(output) : {};
  const stdout =
    textField(rawOutput.stdout) ??
    textField(rawOutput.output) ??
    textField(rawOutput.aggregated_output) ??
    parsedTextOutput.stdout;
  const stderr = textField(rawOutput.stderr) ?? textField(rawOutput.error);
  const exitCode = rawOutput.exit_code ?? rawOutput.exitCode ?? rawOutput.code ?? parsedTextOutput.exitCode;
  return {
    command,
    cwd: textField(rawInput.cwd) ?? textField(rawInput.workdir) ?? textField(rawInput.workingDirectory),
    stdout,
    stderr,
    exitCode: typeof exitCode === 'number' || typeof exitCode === 'string' ? exitCode : undefined,
  };
}

function ShellToolDetails({ summary, failed = false }: { summary: ShellSummary; failed?: boolean }) {
  const commandLines = [
    summary.cwd ? `# ${shortPath(summary.cwd)}` : null,
    `$ ${summary.command}`,
    summary.stdout?.trimEnd() || null,
    summary.stderr?.trimEnd() || null,
  ].filter((line): line is string => !!line);

  return (
    <div data-testid="acp-shell-details" className="w-full overflow-hidden rounded-xl bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-stone-300">
      <div className="px-3 pt-2 text-[13px] font-medium text-neutral-500 dark:text-stone-300">Shell</div>
      <CodeBlock
        code={commandLines.join('\n')}
        language="bash"
        className={cn(
          'max-h-64 border-0 bg-transparent px-3 pb-3 pt-2 font-mono text-[13px] leading-6 text-neutral-700 shadow-none dark:text-stone-200',
          failed && 'text-status-down',
        )}
      />
      {summary.exitCode !== undefined ? (
        <div className="border-t border-black/5 px-3 py-1.5 text-right text-[12px] text-neutral-500 dark:border-white/10 dark:text-stone-400">
          {Number(summary.exitCode) === 0 ? 'Success' : `exit ${summary.exitCode}`}
        </div>
      ) : null}
    </div>
  );
}

function AcpEventIcon({ failed = false }: { failed?: boolean }) {
  return (
    <span
      data-testid="acp-event-icon"
      className={cn(
        ACP_EVENT_ICON_SLOT_CLASS,
        failed ? 'text-status-down' : 'text-neutral-500',
      )}
    >
      <Command className="h-3.5 w-3.5" strokeWidth={1.8} />
    </span>
  );
}

function ShellEventIcon({ failed = false }: { failed?: boolean }) {
  return (
    <span
      data-testid="acp-event-icon"
      className={cn(
        ACP_EVENT_ICON_SLOT_CLASS,
        failed ? 'text-status-down' : 'text-neutral-500',
      )}
    >
      <SquareTerminal className="h-3.5 w-3.5" strokeWidth={1.8} />
    </span>
  );
}

type ShellToolView = {
  tool: AcpToolCallPart;
  summary: ShellSummary;
  running: boolean;
  failed: boolean;
};

type DisplayItem =
  | { type: 'part'; part: ByoMessage['parts'][number]; sourceIndex: number }
  | { type: 'shell_group'; tools: ShellToolView[]; sourceIndex: number };

function normalizedShellOutput(summary: ShellSummary): string {
  return [summary.stdout?.trim(), summary.stderr?.trim()].filter(Boolean).join('\n');
}

function shellDisplayKey(summary: ShellSummary): string {
  return `${summary.command}\n${normalizedShellOutput(summary)}`;
}

function shellViewScore(view: ShellToolView): number {
  return (
    (isGenericShellToolName(view.tool.title) ? 0 : 4) +
    (view.tool.kind === 'execute' || view.tool.kind === 'terminal' ? 2 : 0) +
    (view.summary.stdout ? 2 : 0) +
    (view.summary.stderr ? 1 : 0) +
    (view.summary.exitCode !== undefined ? 1 : 0)
  );
}

function mergeShellView(existing: ShellToolView, incoming: ShellToolView): ShellToolView {
  const preferred = shellViewScore(incoming) >= shellViewScore(existing) ? incoming : existing;
  const fallback = preferred === incoming ? existing : incoming;
  return {
    ...preferred,
    summary: {
      command: preferred.summary.command || fallback.summary.command,
      cwd: preferred.summary.cwd ?? fallback.summary.cwd,
      stdout: preferred.summary.stdout ?? fallback.summary.stdout,
      stderr: preferred.summary.stderr ?? fallback.summary.stderr,
      exitCode: preferred.summary.exitCode ?? fallback.summary.exitCode,
    },
    running: existing.running || incoming.running,
    failed: existing.failed || incoming.failed,
  };
}

function buildDisplayItems(parts: ByoMessage['parts']): DisplayItem[] {
  const items: DisplayItem[] = [];
  const shellSeen = new Map<string, { itemIndex: number; toolIndex: number }>();

  parts.forEach((part, sourceIndex) => {
    if (part.type === 'tool_call' && part.kind !== 'permission') {
      const output = toolOutputForBody(part);
      const summary = shellSummaryForTool(part, output);
      if (summary) {
        const status = part.status ?? 'pending';
        const view: ShellToolView = {
          tool: part,
          summary,
          running: status === 'pending' || status === 'in_progress',
          failed: status === 'failed',
        };
        const key = shellDisplayKey(summary);
        const duplicate = shellSeen.get(key);
        if (duplicate) {
          const item = items[duplicate.itemIndex];
          if (item?.type === 'shell_group') {
            item.tools[duplicate.toolIndex] = mergeShellView(item.tools[duplicate.toolIndex], view);
          }
          return;
        }

        const previous = items[items.length - 1];
        if (previous?.type === 'shell_group') {
          previous.tools.push(view);
          shellSeen.set(key, { itemIndex: items.length - 1, toolIndex: previous.tools.length - 1 });
        } else {
          items.push({ type: 'shell_group', tools: [view], sourceIndex });
          shellSeen.set(key, { itemIndex: items.length - 1, toolIndex: 0 });
        }
        return;
      }
    }
    items.push({ type: 'part', part, sourceIndex });
  });

  return items;
}

function ShellCommandEntry({
  view,
  defaultOpen = false,
  nested = false,
}: {
  view: ShellToolView;
  defaultOpen?: boolean;
  nested?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const label = `${view.running ? 'Running' : 'Ran'} ${view.summary.command}`;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-testid="acp-shell-row"
      className={cn(
        'not-prose w-full text-neutral-500',
        nested ? 'my-0' : 'my-1',
        view.running && 'animate-pulse',
        view.failed && 'text-status-down',
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          size="sm"
          className="group min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4"
        >
          <ShellEventIcon failed={view.failed} />
          <Tooltip label={label}>
            <span className="min-w-0 truncate font-medium text-neutral-500 dark:text-stone-300">
              {label}
            </span>
          </Tooltip>
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <div data-testid="acp-tool-details" className="mt-1 w-full">
          <ShellToolDetails summary={view.summary} failed={view.failed} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ShellCommandGroup({
  tools,
  defaultOpen = false,
}: {
  tools: ShellToolView[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (tools.length === 1) {
    return <ShellCommandEntry view={tools[0]} defaultOpen={defaultOpen} />;
  }

  const failed = tools.some((tool) => tool.failed);
  const running = tools.some((tool) => tool.running);
  const label = `${running ? 'Running' : 'Ran'} ${tools.length} commands`;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-testid="acp-shell-group"
      className={cn(
        'not-prose my-1 w-full text-neutral-500',
        running && 'animate-pulse',
        failed && 'text-status-down',
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          size="sm"
          className="group min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4"
        >
          <ShellEventIcon failed={failed} />
          <span className="min-w-0 truncate font-medium text-neutral-500 dark:text-stone-300">
            {label}
          </span>
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <div className="mt-1 space-y-1.5">
          {tools.map((tool, index) => (
            <ShellCommandEntry
              key={`${tool.tool.toolCallId}-${index}`}
              view={tool}
              defaultOpen={index === 0}
              nested
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ThoughtRow({ text, defaultOpen = false }: { text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasBody = text.trim().length > 0;
  return (
    <Collapsible
      open={hasBody && open}
      onOpenChange={setOpen}
      data-testid="acp-thought-row"
      className="not-prose my-1 w-full text-neutral-500"
    >
      <CollapsibleTrigger asChild>
        <Button
          size="sm"
          disabled={!hasBody}
          className={cn(
            'group min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0',
            hasBody ? 'cursor-pointer focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4' : 'cursor-default',
          )}
        >
          <AcpEventIcon />
          <span className="min-w-0 truncate font-medium text-neutral-500 dark:text-stone-300">
            已思考
          </span>
          {hasBody ? (
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')} />
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <div
          data-testid="acp-thought-details"
          className="mt-1 max-h-[min(420px,45vh)] w-full overflow-y-auto bg-transparent text-[12px] leading-5 text-neutral-500"
        >
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolRow({ tool, defaultOpen = false }: { tool: AcpToolCallPart; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const status = tool.status ?? 'pending';
  const running = status === 'pending' || status === 'in_progress';
  const failed = status === 'failed';
  const output = toolOutputForBody(tool);
  const shellSummary = shellSummaryForTool(tool, output);
  const hasBody =
    shellSummary !== null ||
    tool.rawInput !== undefined ||
    output !== undefined ||
    (tool.locations?.length ?? 0) > 0 ||
    (tool.content?.length ?? 0) > 0;
  const target = pickToolTarget(tool);

  return (
    <Collapsible
      open={hasBody && open}
      onOpenChange={setOpen}
      data-testid="acp-tool-row"
      className={cn(
        'not-prose my-1 w-full text-neutral-500',
        running && 'animate-pulse',
        failed && 'text-status-down',
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          size="sm"
          disabled={!hasBody}
          className={cn(
            'group min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0',
            hasBody ? 'cursor-pointer focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4' : 'cursor-default',
          )}
        >
          <AcpEventIcon failed={failed} />
          <span className="flex min-w-0 max-w-full items-baseline gap-2">
            <span className={cn('shrink-0 font-medium', failed ? 'text-status-down' : 'text-neutral-500 dark:text-stone-300')}>
              {pickToolVerb(tool.kind, status)}
            </span>
            {target ? (
              <Tooltip label={target}>
                <span className="min-w-0 truncate font-sans text-[13px] text-neutral-500 dark:text-stone-300">
                  {target}
                </span>
              </Tooltip>
            ) : null}
          </span>
          {failed ? <XCircle className="h-3.5 w-3.5 shrink-0 text-status-down" /> : null}
          {hasBody ? (
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')} />
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <div
          data-testid="acp-tool-details"
          className="mt-1 max-h-[min(420px,45vh)] w-full space-y-1.5 overflow-y-auto bg-transparent text-[12px] text-neutral-500"
        >
          {tool.locations && tool.locations.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tool.locations.map((loc, index) =>
                loc.path ? (
                  <Tooltip label={loc.path} key={`${loc.path}-${index}`}>
                    <span
                      className="font-sans text-[12px] text-neutral-500 dark:text-stone-300"
                    >
                      {shortPath(loc.path)}
                      {loc.line != null ? `:${loc.line}` : ''}
                    </span>
                  </Tooltip>
                ) : null,
              )}
            </div>
          ) : null}
          {shellSummary ? (
            <ShellToolDetails summary={shellSummary} failed={failed} />
          ) : (
            <>
              {tool.rawInput !== undefined ? (
                <CodeBlock
                  code={formatUnknown(tool.rawInput)}
                  language={typeof tool.rawInput === 'string' ? 'bash' : 'json'}
                  className="border-0 bg-transparent p-0 text-neutral-500 shadow-none"
                />
              ) : null}
              {output !== undefined && output !== null && output !== '' ? (
                <CodeBlock
                  code={formatUnknown(output)}
                  language="text"
                  className={cn(
                    'border-0 bg-transparent p-0 text-neutral-500 shadow-none',
                    failed && 'text-status-down',
                  )}
                />
              ) : null}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function getAcpGlobalState(messages: ByoMessage[]): {
  planEntries: PlanEntry[];
  outputs: AcpAgentOutput[];
} {
  let planEntries: PlanEntry[] = [];
  const outputs: AcpAgentOutput[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (part.type === 'plan') {
        planEntries = part.entries;
      } else if (
        part.type === 'tool_call' &&
        part.kind !== 'permission' &&
        (part.status === 'completed' || part.status === 'failed') &&
        (part.rawOutput !== undefined || part.content !== undefined)
      ) {
        outputs.push({
          id: part.toolCallId,
          label: part.title ?? pickToolTarget(part) ?? part.toolName ?? 'Agent task',
          detail: part.kind,
          status: part.status,
          kind: part.kind,
        });
      }
    }
  }
  return { planEntries, outputs };
}

export function AcpProgressPanel({
  planEntries,
  outputs = [],
  defaultOpen = false,
  className,
}: {
  planEntries: PlanEntry[];
  outputs?: AcpAgentOutput[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (planEntries.length === 0 && outputs.length === 0) return null;
  const completed = planEntries.filter((entry) => entry.status === 'completed').length;
  return (
    <div className={cn('relative', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <IconButton
            label={open ? 'Hide progress' : 'Show progress'}
            icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
            size="sm"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-slate-800 transition-colors hover:bg-warm-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface dark:text-slate-200"
          />
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Progress"
          className="z-[90] w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border-warm-border/70 bg-background/95 p-0 shadow-xl backdrop-blur"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b border-warm-border/60 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Progress</span>
              {planEntries.length > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">{completed}/{planEntries.length}</span>
              ) : null}
            </div>
          </div>
          {planEntries.length > 0 ? (
            <div className="px-3 py-2">
              <Plan entries={planEntries} className="my-0 border-0 bg-transparent p-0" />
            </div>
          ) : null}
          <div className="border-t border-warm-border/60 px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground">Outputs</div>
            {outputs.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {outputs.map((output) => (
                  <li key={output.id} className="flex min-w-0 items-center gap-2 text-xs">
                    {output.status === 'failed' ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-status-down" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-status-ready" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-foreground">{output.label}</span>
                    {output.detail ? <span className="shrink-0 text-muted-foreground">{output.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground/75">No agent tasks yet</div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AcpMessageList({
  messages,
  emptyHint,
  defaultOpenTools = false,
}: {
  messages: ByoMessage[];
  emptyHint?: React.ReactNode;
  defaultOpenTools?: boolean;
}) {
  if (messages.length === 0) {
    return <EmptyState tone="muted">{emptyHint ?? 'No messages yet.'}</EmptyState>;
  }
  return (
    <>
      {messages.map((m) => {
        const displayItems = buildDisplayItems(m.parts);
        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
          >
            <Message
              from={m.role === 'user' ? 'user' : 'assistant'}
              className={m.role === 'assistant' ? 'max-w-full' : undefined}
            >
              <MessageContent
                data-testid={m.role === 'assistant' ? 'acp-assistant-message-content' : undefined}
                className={cn('gap-1.5', m.role === 'assistant' && 'w-full')}
              >
                {displayItems.map((item) => {
                  if (item.type === 'shell_group') {
                    return (
                      <ShellCommandGroup
                        key={`shell-${item.sourceIndex}`}
                        tools={item.tools}
                        defaultOpen={defaultOpenTools}
                      />
                    );
                  }

                  const p = item.part;
                  const i = item.sourceIndex;
                  if (p.type === 'text') {
                    // User messages stay plain (their input rarely contains
                    // markdown); assistant text goes through Response so
                    // GFM tables / bold / lists / code blocks render.
                    if (m.role === 'user') {
                      return (
                        <p key={i} className="text-sm leading-relaxed mb-1 last:mb-0">
                          {p.text}
                        </p>
                      );
                    }
                    return (
                      <div key={i} data-testid="acp-assistant-body" className="max-w-[min(64rem,100%)]">
                        <Response className="font-sans text-[14px] leading-[1.55] text-[#05070d] prose-p:text-[#05070d] prose-li:text-[#05070d] prose-strong:text-[#05070d] prose-code:!rounded-none prose-code:!bg-transparent prose-code:!px-0 prose-code:!py-0 prose-code:!font-sans prose-code:!font-medium prose-code:!text-[#05070d] [&_code]:!rounded-none [&_code]:!bg-transparent [&_code]:!px-0 [&_code]:!py-0 [&_code]:!font-sans [&_code]:!font-medium [&_code]:!tracking-normal [&_code]:!text-[#05070d] dark:text-slate-50 dark:prose-p:text-slate-50 dark:prose-li:text-slate-50 dark:prose-strong:text-slate-50 dark:prose-code:!text-slate-50 dark:[&_code]:!text-slate-50">
                          {p.text}
                        </Response>
                      </div>
                    );
                  }
                  if (p.type === 'thought') {
                    return <ThoughtRow key={i} text={p.text} />;
                  }
                  if (p.type === 'tool_call') {
                    if (p.kind === 'permission') return null;
                    return <ToolRow key={i} tool={p} defaultOpen={defaultOpenTools} />;
                  }
                  if (p.type === 'plan') {
                    return null;
                  }
                  if (p.type === 'event_note') {
                    return (
                      <div
                        key={i}
                        data-testid="acp-event-row"
                        className={cn(
                          'not-prose my-1 flex w-full items-center gap-2 text-[13px] leading-5',
                          p.tone === 'error'
                            ? 'text-status-down'
                            : 'text-neutral-500 dark:text-stone-300',
                        )}
                      >
                        <AcpEventIcon failed={p.tone === 'error'} />
                        <span className="font-medium">{p.title}</span>
                        {p.detail ? <span className="ml-1 opacity-75">{p.detail}</span> : null}
                      </div>
                    );
                  }
                  // raw_event fallback — show update kind in summary so
                  // unhandled ACP frames are at least identifiable.
                  const ev = p.event as { update?: { sessionUpdate?: string; type?: string }; sessionUpdate?: string; type?: string; method?: string } | null | undefined;
                  const kind = ev?.update?.sessionUpdate ?? ev?.update?.type ?? ev?.sessionUpdate ?? ev?.type ?? ev?.method ?? 'unknown';
                  return (
                    <Collapsible key={i} className="not-prose group my-1 w-full text-neutral-500">
                      <CollapsibleTrigger asChild>
                        <Button
                          size="sm"
                          shape="rounded"
                          className="min-h-0 max-w-full cursor-pointer justify-start gap-2 rounded-none border-transparent bg-transparent px-0 py-0 text-left text-[13px] leading-5 text-neutral-500 shadow-none transition-colors hover:bg-transparent hover:text-neutral-700 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4"
                        >
                          <AcpEventIcon />
                          <span className="min-w-0 truncate">event: {kind}</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        <pre className="mt-1 max-h-[min(420px,45vh)] overflow-auto whitespace-pre-wrap bg-transparent p-0 font-mono text-[12px] leading-relaxed text-neutral-500">
                          {JSON.stringify(p.event, null, 2)}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </MessageContent>
            </Message>
          </motion.div>
        );
      })}
    </>
  );
}
