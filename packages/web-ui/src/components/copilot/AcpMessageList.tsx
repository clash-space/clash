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
  ArrowUpRight,
  ChevronRight,
  CheckCircle2,
  Clapperboard,
  ListChecks,
  Command,
  SquareTerminal,
  TriangleAlert,
  X,
  XCircle,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip } from '../ui/tooltip';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import {
  ProjectSurfaceIcon,
  type ProjectSurfaceIconKind,
} from '../ProjectSurfaceIcon';

const ACP_EVENT_ICON_SLOT_CLASS =
  'flex h-5 w-5 shrink-0 items-center justify-center transition-colors group-hover/acp-event:text-neutral-700 dark:group-hover/acp-event:text-stone-200';

export interface AcpAgentOutput {
  id: string;
  label: string;
  detail?: string;
  status?: string;
  kind?: string;
}

export type ClashProjectEntityKind =
  | 'canvas'
  | 'canvas-node'
  | 'timeline'
  | 'director-stage'
  | 'asset';

export interface ClashProjectEntity {
  kind: ClashProjectEntityKind;
  id: string;
  label: string;
  canvasId?: string;
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
  if (status === 'failed') return '调用失败';
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
  if (tool.mcp) return false;
  if (tool.kind === 'execute' || tool.kind === 'terminal') return true;
  if (isGenericShellToolName(tool.title) || isGenericShellToolName(tool.toolName)) return true;
  if (isRecord(tool.rawInput)) {
    const command = tool.rawInput.command ?? tool.rawInput.cmd;
    if (typeof command === 'string' || Array.isArray(command)) return true;
  }
  return Array.isArray(tool.content) && tool.content.some((item) => item.type === 'terminal');
}

type ClashMcpSurface =
  | 'Studio'
  | 'Canvas'
  | 'Timeline'
  | 'Director'
  | 'Assets'
  | 'Models'
  | 'Tasks'
  | 'Text'
  | 'Production'
  | 'Workspace';

function clashMcpSurface(toolName: string | undefined): ClashMcpSurface {
  if (!toolName) return 'Workspace';
  if (toolName === 'clash_studio_open') return 'Studio';
  if (
    toolName.startsWith('clash_canvas_')
    || toolName === 'clash_cli_canvas'
    || toolName === 'clash_cli_canvases'
  ) return 'Canvas';
  if (toolName.startsWith('clash_timeline_') || toolName === 'clash_cli_timeline') return 'Timeline';
  if (toolName.startsWith('clash_director_') || toolName === 'clash_cli_director') return 'Director';
  if (toolName.startsWith('clash_cli_asset')) return 'Assets';
  if (toolName.startsWith('clash_cli_model')) return 'Models';
  if (toolName.startsWith('clash_cli_task')) return 'Tasks';
  if (toolName.startsWith('clash_cli_text')) return 'Text';
  if (toolName.startsWith('clash_cli_production')) return 'Production';
  return 'Workspace';
}

const CLASH_MCP_VERBS: Record<string, string> = {
  open: 'Open',
  list: 'List',
  get: 'Inspect',
  inspect: 'Inspect',
  snapshot: 'Refresh',
  add: 'Add',
  create: 'Create',
  update: 'Update',
  save: 'Save',
  apply: 'Apply',
  delete: 'Delete',
  remove: 'Remove',
  connect: 'Connect',
  disconnect: 'Disconnect',
  attach: 'Attach',
  detach: 'Detach',
  copy: 'Copy',
};

function clashMcpAction(toolName: string | undefined, surface: ClashMcpSurface): string {
  if (!toolName) return `Use ${surface}`;
  if (toolName === 'clash_studio_open') return 'Open Studio';
  const normalizedSurface = surface.toLocaleLowerCase();
  const tokens = toolName.replace(/^clash_(?:cli_)?/, '').split('_');
  const surfaceIndex = tokens.findIndex((token) => token === normalizedSurface || `${token}s` === normalizedSurface);
  const actionToken = tokens[surfaceIndex >= 0 ? surfaceIndex + 1 : tokens.length - 1] ?? '';
  const verb = CLASH_MCP_VERBS[actionToken];
  if (verb) return `${verb} ${surface}`;
  return tokens
    .map((token) => token ? token[0]!.toUpperCase() + token.slice(1) : '')
    .join(' ');
}

function mcpArguments(tool: AcpToolCallPart): unknown {
  if (!isRecord(tool.rawInput)) return tool.rawInput;
  return tool.rawInput.arguments ?? tool.rawInput;
}

function clashMcpCountLabel(toolName: string | undefined, key: string): string {
  if (key !== 'items') return key;
  if (toolName === 'clash_canvas_list') return 'nodes';
  if (toolName === 'clash_canvas_edges') return 'edges';
  if (toolName?.startsWith('clash_cli_asset')) return 'assets';
  if (toolName?.startsWith('clash_cli_model')) return 'models';
  if (toolName?.startsWith('clash_cli_task')) return 'tasks';
  if (toolName?.startsWith('clash_cli_text')) return 'documents';
  if (toolName?.startsWith('clash_cli_production')) return 'productions';
  return key;
}

function clashMcpResult(tool: AcpToolCallPart): {
  summary?: string;
  text?: string;
  structured?: unknown;
} {
  const contentOutput = acpToolContentToOutput(tool.content);
  const rawOuter = isRecord(tool.rawOutput) ? tool.rawOutput : {};
  const rawResult = isRecord(rawOuter.result) ? rawOuter.result : rawOuter;
  const contentOuter = isRecord(contentOutput) ? contentOutput : {};
  const contentResult = isRecord(contentOuter.result) ? contentOuter.result : contentOuter;
  const rawError = rawOuter.error;
  const errorDetails = isRecord(rawError)
    ? Object.fromEntries(
      Object.entries(rawError).filter(([key]) => key !== 'message'),
    )
    : undefined;
  const structured =
    rawResult.structuredContent
    ?? rawResult.structured_content
    ?? contentResult.structuredContent
    ?? contentResult.structured_content
    ?? (errorDetails && Object.keys(errorDetails).length > 0
      ? { error: errorDetails }
      : undefined);
  const structuredRecord = isRecord(structured) ? structured : undefined;
  const counts: Array<[string, unknown]> = [
    ['nodes', structuredRecord?.nodes],
    ['tracks', structuredRecord?.tracks],
    ['clips', structuredRecord?.clips],
    ['stages', structuredRecord?.stages],
    ['projects', structuredRecord?.projects],
    ['items', structuredRecord?.items],
  ];
  const count = counts.find((entry) => Array.isArray(entry[1]));
  const summary = count && Array.isArray(count[1])
    ? `${count[1].length} ${clashMcpCountLabel(tool.mcp?.toolName, count[0])}`
    : undefined;
  const contentText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value.trim() || undefined;
    if (!isRecord(value) || !Array.isArray(value.content)) return undefined;
    return value.content
      .flatMap((entry) => isRecord(entry) && typeof entry.text === 'string' ? [entry.text] : [])
      .join('\n')
      .trim() || undefined;
  };
  const text =
    contentText(rawResult)
    ?? contentText(tool.rawOutput)
    ?? contentText(contentResult)
    ?? (typeof rawError === 'string'
      ? rawError.trim() || undefined
      : textField(isRecord(rawError) ? rawError.message : undefined))
    ?? (typeof contentOutput === 'string' ? contentOutput.trim() || undefined : undefined);
  return { summary, text, structured };
}

type ClashMcpResultFact = {
  label: string;
  value: string;
};

const CLASH_MCP_HIDDEN_RESULT_KEYS = new Set([
  'canvasId',
  'canvas_id',
  'nodeId',
  'node_id',
  'timelineId',
  'timeline_id',
  'stageId',
  'stage_id',
  'directorStageId',
  'assetId',
  'asset_id',
  'id',
  'cwd',
  'path',
  'filePath',
  'file_path',
  'items',
  'nodes',
  'tracks',
  'clips',
  'stages',
  'projects',
]);

function clashMcpFactLabel(path: readonly string[]): string {
  return path
    .flatMap((part) => part
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\bms\b$/i, '')
      .trim()
      .split(/\s+/))
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

function clashMcpFactValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function clashMcpResultFacts(
  structured: unknown,
  path: readonly string[] = [],
  depth = 0,
): ClashMcpResultFact[] {
  if (!isRecord(structured) || depth > 2) return [];
  return Object.entries(structured).flatMap(([key, value]) => {
    if (CLASH_MCP_HIDDEN_RESULT_KEYS.has(key) || value === null || value === undefined) {
      return [];
    }
    const nextPath = [...path, key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [{
        label: clashMcpFactLabel(nextPath),
        value: clashMcpFactValue(value),
      }];
    }
    if (Array.isArray(value)) {
      return [{
        label: clashMcpFactLabel(nextPath),
        value: `${value.length} ${value.length === 1 ? 'item' : 'items'}`,
      }];
    }
    return clashMcpResultFacts(value, nextPath, depth + 1);
  });
}

function ClashMcpResultDetails({
  text,
  facts,
  failed,
}: {
  text?: string;
  facts: readonly ClashMcpResultFact[];
  failed: boolean;
}) {
  if (!text && facts.length === 0) return null;
  return (
    <div
      data-testid="clash-mcp-result"
      className={cn(
        'max-w-md space-y-1.5 text-[12px] leading-5 text-neutral-500 dark:text-stone-300',
        failed && 'text-status-down',
      )}
    >
      {text ? <p className="m-0 whitespace-pre-wrap text-pretty">{text}</p> : null}
      {facts.length > 0 ? (
        <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {facts.map((fact) => (
            <div key={`${fact.label}-${fact.value}`} className="contents">
              <dt className="truncate text-neutral-400 dark:text-stone-500">{fact.label}</dt>
              <dd className="m-0 min-w-0 break-words text-neutral-600 dark:text-stone-200">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function entityLabelFromId(id: string): string {
  if (id === 'main') return 'Main';
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function stringProperty(
  value: unknown,
  keys: readonly string[],
): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function cliArgumentValue(value: unknown, flags: readonly string[]): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.args)) return undefined;
  const args = value.args.filter((item): item is string => typeof item === 'string');
  for (const flag of flags) {
    const index = args.indexOf(flag);
    const candidate = index >= 0 ? args[index + 1] : undefined;
    if (candidate?.trim()) return candidate.trim();
  }
  return undefined;
}

function resolveClashEntityLabel(
  kind: ClashProjectEntityKind,
  id: string,
  knownEntities: readonly ClashProjectEntity[],
): string {
  return knownEntities.find((entity) => entity.kind === kind && entity.id === id)?.label
    ?? entityLabelFromId(id);
}

function clashMcpEntities(
  tool: AcpToolCallPart,
  result: ReturnType<typeof clashMcpResult>,
  knownEntities: readonly ClashProjectEntity[],
): ClashProjectEntity[] {
  const surface = clashMcpSurface(tool.mcp?.toolName);
  const args = mcpArguments(tool);
  const structured = result.structured;

  if (surface === 'Canvas') {
    const canvasId =
      stringProperty(args, ['canvasId', 'canvas_id'])
      ?? cliArgumentValue(args, ['--canvas', '--canvas-id'])
      ?? stringProperty(structured, ['canvasId', 'canvas_id'])
      ?? 'main';
    const nodeId =
      stringProperty(args, ['nodeId', 'node_id'])
      ?? cliArgumentValue(args, ['--node', '--node-id']);
    const nodeSpecificTool = nodeId && ![
      'clash_canvas_list',
      'clash_canvas_edges',
      'clash_canvas_open',
      'clash_canvas_snapshot',
      'clash_canvas_search',
    ].includes(tool.mcp?.toolName ?? '');
    if (nodeSpecificTool && nodeId) {
      return [{
        kind: 'canvas-node',
        id: nodeId,
        label: resolveClashEntityLabel('canvas-node', nodeId, knownEntities),
        canvasId,
      }];
    }
    return [{
      kind: 'canvas',
      id: canvasId,
      label: resolveClashEntityLabel('canvas', canvasId, knownEntities),
    }];
  }

  const entityConfig: Partial<Record<ClashMcpSurface, {
    kind: Exclude<ClashProjectEntityKind, 'canvas' | 'canvas-node'>;
    idKeys: string[];
  }>> = {
    Timeline: { kind: 'timeline', idKeys: ['timelineId', 'timeline_id', 'id'] },
    Director: { kind: 'director-stage', idKeys: ['stageId', 'stage_id', 'directorStageId', 'id'] },
    Assets: { kind: 'asset', idKeys: ['assetId', 'asset_id', 'id'] },
  };
  const config = entityConfig[surface];
  if (!config) return [];

  const directId =
    stringProperty(args, config.idKeys)
    ?? cliArgumentValue(
      args,
      config.kind === 'timeline'
        ? ['--timeline', '--timeline-id', '--id']
        : config.kind === 'director-stage'
          ? ['--stage', '--stage-id', '--id']
          : ['--asset', '--asset-id', '--id'],
    )
    ?? stringProperty(structured, config.idKeys);
  if (directId) {
    return [{
      kind: config.kind,
      id: directId,
      label: resolveClashEntityLabel(config.kind, directId, knownEntities),
    }];
  }

  const items = isRecord(structured) && Array.isArray(structured.items)
    ? structured.items
    : [];
  return items.flatMap((item) => {
    const id = stringProperty(item, config.idKeys);
    if (!id) return [];
    const returnedLabel = stringProperty(item, ['label', 'name', 'title', 'fileName', 'filename']);
    return [{
      kind: config.kind,
      id,
      label: returnedLabel ?? resolveClashEntityLabel(config.kind, id, knownEntities),
    }];
  });
}

function clashEntityKindLabel(kind: ClashProjectEntityKind): string {
  switch (kind) {
    case 'canvas':
      return 'Canvas';
    case 'canvas-node':
      return 'Canvas node';
    case 'timeline':
      return 'Timeline';
    case 'director-stage':
      return 'Director Stage';
    case 'asset':
      return 'Asset';
  }
}

function clashProjectEntitySurface(
  kind: ClashProjectEntityKind,
): ProjectSurfaceIconKind {
  if (kind === 'canvas-node') return 'canvas';
  return kind;
}

function ClashProjectEntityResult({
  entity,
  summary,
  onOpen,
}: {
  entity: ClashProjectEntity;
  summary?: string;
  onOpen?: (entity: ClashProjectEntity) => void;
}) {
  const kindLabel = clashEntityKindLabel(entity.kind);
  const content = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#E65F48]/10 text-[#D94F38] dark:bg-[#FF8068]/12 dark:text-[#FF8068]">
        <ProjectSurfaceIcon
          surface={clashProjectEntitySurface(entity.kind)}
          className="h-3.5 w-3.5"
          weight="duotone"
          aria-hidden="true"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-[13px] font-medium text-neutral-700 dark:text-stone-100">
          {entity.label}
        </span>
        <span className="truncate text-[11px] text-neutral-400 dark:text-stone-400">
          {[kindLabel, summary].filter(Boolean).join(' · ')}
        </span>
      </span>
      {onOpen ? (
        <ArrowUpRight
          className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition-colors group-hover/clash-entity:text-neutral-700 dark:group-hover/clash-entity:text-stone-100"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
  const className =
    'group/clash-entity flex w-full max-w-md items-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/80 px-2.5 py-2 text-left shadow-none transition-colors dark:border-white/10 dark:bg-white/[0.045]';

  if (!onOpen) {
    return (
      <div data-testid="clash-project-entity" className={className}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid="clash-project-entity"
      aria-label={`Open ${kindLabel} ${entity.label}`}
      className={cn(
        className,
        'cursor-pointer hover:border-neutral-300 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 dark:hover:border-white/20 dark:hover:bg-white/[0.075]',
      )}
      onClick={() => onOpen(entity)}
    >
      {content}
    </button>
  );
}

function isClashMcpTool(tool: AcpToolCallPart): boolean {
  return (
    tool.mcp?.serverName === 'clash' &&
    tool.mcp.renderer === 'product' &&
    tool.meta?.['clash.host_trusted_mcp'] === true
  );
}

function ClashMcpToolRow({
  tool,
  defaultOpen = false,
  knownEntities = [],
  onOpenEntity,
}: {
  tool: AcpToolCallPart;
  defaultOpen?: boolean;
  knownEntities?: readonly ClashProjectEntity[];
  onOpenEntity?: (entity: ClashProjectEntity) => void;
}) {
  const status = tool.status ?? 'pending';
  const running = status === 'pending' || status === 'in_progress';
  const failed = status === 'failed';
  const surface = clashMcpSurface(tool.mcp?.toolName);
  const action = clashMcpAction(tool.mcp?.toolName, surface);
  const result = clashMcpResult(tool);
  const entities = clashMcpEntities(tool, result, knownEntities);
  const visibleText = result.text && !/^\s*[[{]/.test(result.text)
    ? result.text
    : undefined;
  const facts = clashMcpResultFacts(result.structured);
  const hasBody = entities.length > 0 || Boolean(visibleText) || facts.length > 0;
  const projectSurface =
    surface === 'Canvas'
      ? 'canvas'
      : surface === 'Timeline'
        ? 'timeline'
        : surface === 'Director'
          ? 'director-stage'
          : surface === 'Assets'
            ? 'asset'
            : null;

  return (
    <Collapsible
      key={hasBody ? 'with-body' : 'empty'}
      defaultOpen={hasBody && defaultOpen}
      data-testid="clash-mcp-block"
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
            'group/acp-event min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0',
            hasBody ? 'cursor-pointer focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4' : 'cursor-default',
          )}
        >
          <span
            data-testid="clash-product-icon"
            className="flex h-5 w-5 shrink-0 items-center justify-center text-[#D94F38] transition-colors group-hover/acp-event:text-[#B9402D] dark:text-[#FF8068] dark:group-hover/acp-event:text-[#FF9B88]"
          >
            {projectSurface ? (
              <ProjectSurfaceIcon
                surface={projectSurface}
                className="h-3.5 w-3.5"
                weight="duotone"
                aria-hidden="true"
              />
            ) : (
              <Clapperboard className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </span>
          <span className="flex min-w-0 max-w-full items-baseline gap-2">
            <span className={cn('shrink-0 font-medium text-neutral-500 dark:text-stone-300', failed && 'text-status-down')}>
              {action}
            </span>
            {result.summary ? (
              <span className="truncate text-[12px] font-normal text-neutral-400 dark:text-stone-400">
                {result.summary}
              </span>
            ) : null}
          </span>
          {failed ? <XCircle className="h-3.5 w-3.5 shrink-0 text-status-down" /> : null}
          {hasBody ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-data-[state=open]/acp-event:rotate-90" />
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <div className="mt-1 space-y-1.5 pl-7 text-[12px]">
          {entities.map((entity) => (
            <ClashProjectEntityResult
              key={`${entity.kind}-${entity.id}`}
              entity={entity}
              summary={result.summary}
              onOpen={onOpenEntity}
            />
          ))}
          <ClashMcpResultDetails text={visibleText} facts={facts} failed={failed} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
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
  const label = `${view.running ? 'Running' : 'Ran'} ${view.summary.command}`;

  return (
    <Collapsible
      defaultOpen={defaultOpen}
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
          className="group/acp-event min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4"
        >
          <ShellEventIcon failed={view.failed} />
          <Tooltip label={label}>
            <span className="min-w-0 truncate font-medium text-neutral-500 dark:text-stone-300">
              {label}
            </span>
          </Tooltip>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-data-[state=open]/acp-event:rotate-90" />
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
  if (tools.length === 1) {
    return <ShellCommandEntry view={tools[0]} defaultOpen={defaultOpen} />;
  }

  const failed = tools.some((tool) => tool.failed);
  const running = tools.some((tool) => tool.running);
  const label = `${running ? 'Running' : 'Ran'} ${tools.length} commands`;
  return (
    <Collapsible
      defaultOpen={defaultOpen}
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
          className="group/acp-event min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4"
        >
          <ShellEventIcon failed={failed} />
          <span className="min-w-0 truncate font-medium text-neutral-500 dark:text-stone-300">
            {label}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-data-[state=open]/acp-event:rotate-90" />
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

function thoughtProjectionLines(text: string, fallback: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [fallback];
}

function ThoughtRow({
  text,
  defaultOpen = false,
  label = '已思考',
  live = false,
}: {
  text: string;
  defaultOpen?: boolean;
  label?: string;
  live?: boolean;
}) {
  const hasBody = text.trim().length > 0;
  const projectionLines = thoughtProjectionLines(text, label);
  return (
    <Collapsible
      key={hasBody ? 'with-body' : 'empty'}
      defaultOpen={hasBody && defaultOpen}
      data-testid="acp-thought-row"
      className="not-prose my-1 w-full text-neutral-500"
    >
      <CollapsibleTrigger asChild>
        <Button
          size="sm"
          disabled={!hasBody}
          className={cn(
            'group/acp-event min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0',
            hasBody ? 'cursor-pointer focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4' : 'cursor-default',
          )}
        >
          {live ? null : <AcpEventIcon />}
          <span className="min-w-0 flex-1 text-left font-medium text-neutral-500 dark:text-stone-300">
            {live ? (
              <span className="block min-w-0" data-thought-projection="lines">
                {projectionLines.map((line, index) => (
                  <span
                    key={`${index}-${line}`}
                    data-testid="acp-thought-projection-line"
                    className="block min-w-0 truncate leading-6"
                  >
                    {line}
                  </span>
                ))}
              </span>
            ) : label}
          </span>
          {hasBody ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-data-[state=open]/acp-event:rotate-90" />
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount={live || undefined} asChild>
        <div
          data-testid="acp-thought-details"
          data-thought-stream-body={live ? 'true' : undefined}
          className="mt-1 w-full bg-transparent text-[12px] leading-5 text-neutral-500 data-[state=closed]:hidden"
        >
          <Response className="font-sans text-[12px] leading-5 text-neutral-500 prose-p:text-neutral-500 prose-li:text-neutral-500 prose-strong:text-neutral-600 dark:text-stone-300 dark:prose-p:text-stone-300 dark:prose-li:text-stone-300 dark:prose-strong:text-stone-200">
            {text}
          </Response>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function WarningRow({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="alert"
      data-testid="acp-warning-row"
      className="not-prose my-1 flex w-full items-start gap-2 text-[12px] leading-5 text-neutral-500 dark:text-stone-300"
    >
      <span
        data-testid="acp-warning-icon"
        className="flex h-5 w-5 shrink-0 items-center justify-center text-status-busy"
      >
        <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-pretty">
        <span className="font-medium text-neutral-600 dark:text-stone-200">
          {title}
        </span>
        <span className="ml-1.5">{detail}</span>
      </span>
      <button
        type="button"
        aria-label="Dismiss warning"
        onClick={() => setDismissed(true)}
        className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 opacity-70 transition-colors hover:bg-neutral-100 hover:text-neutral-700 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 dark:hover:bg-white/[0.07] dark:hover:text-stone-100"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <div data-testid="acp-assistant-body" className="max-w-[min(64rem,100%)]">
      <Response className="font-sans text-[14px] leading-[1.55] text-[#05070d] prose-p:text-[#05070d] prose-li:text-[#05070d] prose-strong:text-[#05070d] prose-code:!rounded-none prose-code:!bg-transparent prose-code:!px-0 prose-code:!py-0 prose-code:!font-sans prose-code:!font-medium prose-code:!text-[#05070d] [&_code]:!rounded-none [&_code]:!bg-transparent [&_code]:!px-0 [&_code]:!py-0 [&_code]:!font-sans [&_code]:!font-medium [&_code]:!tracking-normal [&_code]:!text-[#05070d] dark:text-slate-50 dark:prose-p:text-slate-50 dark:prose-li:text-slate-50 dark:prose-strong:text-slate-50 dark:prose-code:!text-slate-50 dark:[&_code]:!text-slate-50">
        {text}
      </Response>
    </div>
  );
}

function ToolRow({ tool, defaultOpen = false }: { tool: AcpToolCallPart; defaultOpen?: boolean }) {
  const status = tool.status ?? 'pending';
  const running = status === 'pending' || status === 'in_progress';
  const failed = status === 'failed';
  const output = toolOutputForBody(tool);
  const shellSummary = shellSummaryForTool(tool, output);
  const claudeCodeMeta = isRecord(tool.meta?.claudeCode) ? tool.meta.claudeCode : {};
  const nonExecutionKind = textField(claudeCodeMeta.nonExecutionKind);
  const userFeedback = textField(claudeCodeMeta.userFeedback);
  const hasBody =
    shellSummary !== null ||
    tool.rawInput !== undefined ||
    output !== undefined ||
    nonExecutionKind !== undefined ||
    userFeedback !== undefined ||
    (tool.locations?.length ?? 0) > 0 ||
    (tool.content?.length ?? 0) > 0;
  const target = pickToolTarget(tool);

  return (
    <Collapsible
      key={hasBody ? 'with-body' : 'empty'}
      defaultOpen={hasBody && defaultOpen}
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
            'group/acp-event min-h-0 max-w-full justify-start gap-2 rounded-none border-transparent bg-transparent p-0 text-left text-[13px] leading-5 shadow-none hover:bg-transparent focus-visible:ring-0',
            hasBody ? 'cursor-pointer focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4' : 'cursor-default',
          )}
        >
          <AcpEventIcon failed={failed} />
          <span className="flex min-w-0 max-w-full items-baseline gap-2">
            <span className={cn('shrink-0 font-medium', failed ? 'text-status-down' : 'text-neutral-500 dark:text-stone-300')}>
              {nonExecutionKind ? '未执行' : pickToolVerb(tool.kind, status)}
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
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-data-[state=open]/acp-event:rotate-90" />
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <div
          data-testid="acp-tool-details"
          className="mt-1 max-h-[min(420px,45vh)] w-full space-y-1.5 overflow-y-auto bg-transparent text-[12px] text-neutral-500"
        >
          {nonExecutionKind ? (
            <div
              data-testid="acp-tool-nonexecution"
              className="rounded-md border border-status-down/20 bg-status-down/[0.06] px-2.5 py-2 text-status-down"
            >
              <div className="font-medium">{nonExecutionKind}</div>
              {userFeedback ? <div className="mt-0.5 text-current/80">{userFeedback}</div> : null}
            </div>
          ) : null}
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
  if (planEntries.length === 0 && outputs.length === 0) return null;
  const completed = planEntries.filter((entry) => entry.status === 'completed').length;
  return (
    <div className={cn('relative', className)}>
      <Popover defaultOpen={defaultOpen}>
        <PopoverTrigger asChild>
          <IconButton
            label="Toggle progress"
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
  clashEntities = [],
  onOpenClashEntity,
  agentId,
  isStreaming = false,
}: {
  messages: ByoMessage[];
  emptyHint?: React.ReactNode;
  defaultOpenTools?: boolean;
  clashEntities?: readonly ClashProjectEntity[];
  onOpenClashEntity?: (entity: ClashProjectEntity) => void;
  agentId?: string | null;
  isStreaming?: boolean;
}) {
  if (messages.length === 0) {
    return <EmptyState tone="muted">{emptyHint ?? 'No messages yet.'}</EmptyState>;
  }
  const liveAssistantMessageIndex = isStreaming
    ? messages.reduce(
      (latest, message, index) => message.role === 'assistant' ? index : latest,
      -1,
    )
    : -1;
  return (
    <>
      {messages.map((m, messageIndex) => {
        const displayItems = buildDisplayItems(m.parts);
        const codexThoughtPolicy = typeof agentId === 'string' && /(?:^|[-_])codex(?:[-_]|$)/i.test(agentId);
        const liveThoughtIndex = messageIndex === liveAssistantMessageIndex
          && m.parts.at(-1)?.type === 'thought'
          ? m.parts.length - 1
          : -1;
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
                    return <AssistantText key={i} text={p.text} />;
                  }
                  if (p.type === 'thought') {
                    if (i === liveThoughtIndex) {
                      return <ThoughtRow key={i} text={p.text} label="思考中" live />;
                    }
                    if (codexThoughtPolicy) return null;
                    return <ThoughtRow key={i} text={p.text} />;
                  }
                  if (p.type === 'tool_call') {
                    if (p.kind === 'permission') return null;
                    if (isClashMcpTool(p)) {
                      return (
                        <ClashMcpToolRow
                          key={i}
                          tool={p}
                          defaultOpen={defaultOpenTools}
                          knownEntities={clashEntities}
                          onOpenEntity={onOpenClashEntity}
                        />
                      );
                    }
                    return <ToolRow key={i} tool={p} defaultOpen={defaultOpenTools} />;
                  }
                  if (p.type === 'plan') {
                    return null;
                  }
                  if (p.type === 'event_note') {
                    if (p.tone === 'warning' && p.detail) {
                      return (
                        <WarningRow
                          key={i}
                          title={p.title}
                          detail={p.detail}
                        />
                      );
                    }
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
                    <Collapsible key={i} className="not-prose my-1 w-full text-neutral-500">
                      <CollapsibleTrigger asChild>
                        <Button
                          size="sm"
                          shape="rounded"
                          className="group/acp-event min-h-0 max-w-full cursor-pointer justify-start gap-2 rounded-none border-transparent bg-transparent px-0 py-0 text-left text-[13px] leading-5 text-neutral-500 shadow-none transition-colors hover:bg-transparent hover:text-neutral-700 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-4"
                        >
                          <AcpEventIcon />
                          <span className="min-w-0 truncate">event: {kind}</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform group-data-[state=open]/acp-event:rotate-90" aria-hidden="true" />
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
