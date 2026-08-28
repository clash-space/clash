"use client";

import type {
  AgentUIMessageItem,
  AgentUIStore,
  AgentUIToolItem,
  AgentUITurnState,
} from "@openma/common/agent-ui";
import {
  AgentUIStreamingMarkdown,
  AgentUIStreamingThoughtProjection,
  useAgentUIState,
} from "@openma/common/agent-ui/react";
import {
  CHAT_ASSISTANT_MARKDOWN_CLASS,
  CHAT_THOUGHT_MARKDOWN_CLASS,
  AgentChatView,
  AgentUITurnView,
  ChatMarkdown,
  ChatThoughtEventRow,
  projectChatThoughtEvent,
  type AgentChatViewSlots,
  type ChatCollapsiblePrimitives,
  type ChatThoughtEventProjection,
} from "@openma/common/chat-ui";
import { ListChecksIcon, Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";

import type { MentionableNode } from "../MilkdownEditor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  AcpAssistantTextInline,
  AcpToolInline,
  pickToolVerb,
  type ClashProjectEntity,
} from "./AcpInlineRenderers";
import { UserMessage } from "./UserMessage";

const CLASH_COLLAPSIBLE_PRIMITIVES: ChatCollapsiblePrimitives = {
  Root: Collapsible,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
};

export function RuntimeSessionTimeline({
  store,
  mentionableNodes,
  clashEntities,
  onOpenClashEntity,
  phase = "active",
  slots,
  className,
}: {
  store: AgentUIStore;
  agentId?: string | null;
  mentionableNodes: MentionableNode[];
  clashEntities: readonly ClashProjectEntity[];
  onOpenClashEntity?: (entity: ClashProjectEntity) => void;
  phase?: "missing" | "draft" | "active";
  slots?: AgentChatViewSlots;
  className?: string;
}) {
  const state = useAgentUIState(store);
  const turns = state.turnOrder.flatMap((turnId) => {
    const turn = state.turns[turnId];
    return turn ? [turn] : [];
  });
  return (
    <div
      className={className}
      data-testid="runtime-session-timeline"
      data-renderer="backchat"
      data-backchat-session-timeline="true"
    >
      <AgentChatView
        sessionId={state.sessionId}
        surface="main"
        phase={phase}
        turns={turns}
        slots={slots ?? { composer: null }}
        renderTurn={({ turn }) => (
          <RuntimeTurn
            key={turn.id}
            store={store}
            turn={turn}
            mentionableNodes={mentionableNodes}
            clashEntities={clashEntities}
            onOpenClashEntity={onOpenClashEntity}
          />
        )}
      />
    </div>
  );
}

function RuntimeTurn({
  store,
  turn,
  mentionableNodes,
  clashEntities,
  onOpenClashEntity,
}: {
  store: AgentUIStore;
  turn: AgentUITurnState;
  mentionableNodes: MentionableNode[];
  clashEntities: readonly ClashProjectEntity[];
  onOpenClashEntity?: (entity: ClashProjectEntity) => void;
}) {
  return (
    <AgentUITurnView
      sessionId={store.getState().sessionId}
      turn={turn}
      thoughts="history"
      activityTools="all"
      collapsiblePrimitives={CLASH_COLLAPSIBLE_PRIMITIVES}
      className="!max-w-3xl"
      labels={{
        workingFor: (seconds) => `正在工作 ${seconds} 秒`,
        workedFor: (seconds) => `已工作 ${seconds} 秒`,
        thinking: "正在思考",
        thoughtFor: (seconds) => `已思考 ${seconds} 秒`,
        toolActivity: describeTool,
        toolRunSummary: (tools) => `已执行 ${tools.length} 项操作`,
      }}
      slots={{
        renderPrompt: ({ item }) =>
          item.text ? (
            <UserMessage content={item.text} mentionNodes={mentionableNodes} />
          ) : null,
        renderAssistant: ({ item, section, live, prefixSkip }) =>
          live && item.status === "streaming" ? (
            <AgentUIStreamingMarkdown
              store={store}
              turnId={turn.id}
              kind="assistant"
              prefixSkip={prefixSkip}
              paceReplay={section === "process"}
              className={CHAT_ASSISTANT_MARKDOWN_CLASS}
            />
          ) : (
            <AcpAssistantTextInline text={item.text} section={section} />
          ),
        projectThoughtActivity: ({ item, live, prefixSkip }) =>
          projectClashThought({ store, turn, item, live, prefixSkip }),
        renderThought: ({ item, live, prefixSkip }) => {
          const projection = projectClashThought({
            store,
            turn,
            item,
            live,
            prefixSkip,
          });
          return (
            <ChatThoughtEventRow
              live={live}
              text={item.text}
              liveFallback="正在思考"
              completedLabel={`已思考 ${itemContentNumber(item, "durationSeconds")} 秒`}
              projection={projection}
              renderBody={() =>
                live ? (
                  <AgentUIStreamingMarkdown
                    store={store}
                    turnId={turn.id}
                    kind="thought"
                    prefixSkip={prefixSkip}
                    paceReplay
                    className={CHAT_THOUGHT_MARKDOWN_CLASS}
                  />
                ) : (
                  <ChatMarkdown
                    text={item.text}
                    className={CHAT_THOUGHT_MARKDOWN_CLASS}
                  />
                )
              }
            />
          );
        },
        projectToolActivity: ({ tool, live }) => ({
          leading: live || isToolRunning(tool) ? (
            <Loader2Icon className="chat-activity-icon animate-spin" />
          ) : (
            <ListChecksIcon className="chat-activity-icon" />
          ),
          summary: describeTool(tool, live),
        }),
        projectToolRun: ({ tools }) => ({
          leading: (
            <ListChecksIcon className="chat-activity-icon text-fg-muted" />
          ),
          summary: `已执行 ${tools.length} 项操作`,
        }),
        renderTool: ({ tool }) => (
          <AcpToolInline
            tool={tool}
            defaultOpen={false}
            clashEntities={clashEntities}
            onOpenClashEntity={onOpenClashEntity}
          />
        ),
        renderError: ({ message }) => (
          <p className="text-sm text-status-down">{message ?? "运行失败"}</p>
        ),
      }}
    />
  );
}

function projectClashThought({
  store,
  turn,
  item,
  live,
  prefixSkip,
}: {
  store: AgentUIStore;
  turn: AgentUITurnState;
  item: AgentUIMessageItem;
  live: boolean;
  prefixSkip: number;
}): ChatThoughtEventProjection {
  return projectChatThoughtEvent({
    text: item.text,
    live,
    liveFallback: "正在思考",
    completedLabel: `已思考 ${itemContentNumber(item, "durationSeconds")} 秒`,
    renderLiveSummary: (fallback) => (
      <AgentUIStreamingThoughtProjection
        store={store}
        turnId={turn.id}
        prefixSkip={prefixSkip}
        fallback={String(fallback)}
        mode="body"
      />
    ),
  });
}

function itemContentNumber(
  item: AgentUIMessageItem,
  key: "durationSeconds",
): number {
  if (!item.content || typeof item.content !== "object") return 0;
  const value = (item.content as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

function describeTool(tool: AgentUIToolItem, live = false): ReactNode {
  const target = tool.title || tool.name || tool.toolKind || "工具调用";
  const status = live ? "in_progress" : tool.status;
  return `${pickToolVerb(tool.toolKind, status)} ${target}`.trim();
}

function isToolRunning(tool: AgentUIToolItem): boolean {
  return tool.status === "pending" || tool.status === "in_progress";
}
