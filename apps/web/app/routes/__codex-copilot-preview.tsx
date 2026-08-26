import { createAgentUIStore } from "@openma/common/agent-ui";
import { decodeAcpSessionUpdate } from "@openma/common/protocol/acp";
import { createOpenMAEvent } from "@openma/common/session-events/openma";
import { ChatInput } from "@clash/web-ui/components/copilot/ChatInput";
import { RuntimeSessionTimeline } from "@clash/web-ui/components/copilot/RuntimeSessionTimeline";
import { AcpAgentLogo } from "@clash/gui/components/copilot/AcpAgentLogo";
import { Button } from "@clash/gui/components/ui/button";
import {
  SelectMenu,
  type SelectSection,
} from "@clash/gui/components/ui/select";
import { useMemo, useState } from "react";
import { CaretDown, ShieldWarning } from "@phosphor-icons/react";

function createPreviewStore() {
  const sessionId = "codex-copilot-preview";
  const turnId = "list-canvas";
  const store = createAgentUIStore(sessionId);
  const source = { kind: "harness" as const, harness: "codex-acp" };
  let sequence = 0;
  const dispatchAcp = (update: unknown) => {
    sequence += 1;
    store.dispatch(
      decodeAcpSessionUpdate(sessionId, update, {
        eventId: `preview:${sequence}`,
        occurredAt: new Date(sequence * 1_000).toISOString(),
        turnId,
        seq: sequence,
        harness: "codex-acp",
      }).event,
    );
  };

  store.dispatch(
    createOpenMAEvent({
      event_id: "preview:user",
      type: "user.message",
      session_id: sessionId,
      turn_id: turnId,
      source: { kind: "user" },
      occurred_at: new Date(0).toISOString(),
      data: { text: "列出画布上的节点。" },
    }),
  );
  store.dispatch(
    createOpenMAEvent({
      event_id: "preview:running",
      type: "session.running",
      session_id: sessionId,
      turn_id: turnId,
      source,
      occurred_at: new Date(500).toISOString(),
      data: {},
    }),
  );
  dispatchAcp({
    sessionUpdate: "agent_thought_chunk",
    content: {
      type: "text",
      text: "先确认画布状态，再把节点按类型整理出来。",
    },
  });
  dispatchAcp({
    sessionUpdate: "tool_call",
    toolCallId: "tool-list-canvas",
    title: "List canvas nodes",
    kind: "list",
    status: "completed",
    rawInput: { query: "canvas.nodes", projectId: "mock-project" },
    rawOutput: [
      {
        id: "dianmwa7",
        type: "action-badge",
        label: "Image Prompt",
      },
      {
        id: "lrcleamx",
        type: "image",
        status: "completed",
        size: "500 x 281",
      },
      {
        id: "upload-1781414847642-oq6cbcl",
        type: "image",
        fileName: "258251d8857f30efff6b9b7085302bf5.JPG",
      },
    ],
  });
  dispatchAcp({
    sessionUpdate: "agent_message_chunk",
    _meta: { codex: { phase: "final_answer" } },
    content: {
      type: "text",
      text: "画布上当前有 **3 个节点**，其中一个是当前选中的素材引用。",
    },
  });
  store.dispatch(
    createOpenMAEvent({
      event_id: "preview:completed",
      type: "turn.completed",
      session_id: sessionId,
      turn_id: turnId,
      source,
      occurred_at: new Date(5_000).toISOString(),
      data: {},
    }),
  );
  return store;
}

const previewStore = createPreviewStore();

export default function CodexCopilotPreview() {
  const [draft, setDraft] = useState("");
  const [permissionMode, setPermissionMode] = useState<"default" | "full">(
    "full",
  );
  const [selectedHarness, setSelectedHarness] = useState("codex");
  const [selectedModel, setSelectedModel] = useState("gpt-5.5");
  const [selectedEffort, setSelectedEffort] = useState("low");
  const modelSections = useMemo<SelectSection<string>[]>(() => {
    const modelOptions =
      selectedHarness === "claude"
        ? [
            { value: "sonnet-4.6", label: "Claude Sonnet 4.6" },
            { value: "opus-4.6", label: "Claude Opus 4.6" },
          ]
        : selectedHarness === "gemini"
          ? [
              { value: "3.5-flash", label: "Gemini 3.5 Flash" },
              { value: "3.1-pro", label: "Gemini 3.1 Pro" },
            ]
          : [
              { value: "gpt-5.5", label: "GPT-5.5" },
              { value: "gpt-5.4", label: "GPT-5.4" },
              { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
            ];
    const effortSections: SelectSection<string>[] = [
      {
        id: "codex-effort",
        label: (
          <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">
            Effort
          </span>
        ),
        options: [
          {
            value: "effort:minimal",
            label: "Minimal",
            selected: selectedEffort === "minimal",
          },
          {
            value: "effort:low",
            label: "Low",
            selected: selectedEffort === "low",
          },
          {
            value: "effort:medium",
            label: "Medium",
            selected: selectedEffort === "medium",
          },
          {
            value: "effort:high",
            label: "High",
            selected: selectedEffort === "high",
          },
          {
            value: "effort:very-high",
            label: "Very high",
            selected: selectedEffort === "very-high",
          },
        ],
      },
    ];
    return [
      {
        id: "harness",
        label: (
          <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">
            Harness
          </span>
        ),
        options: [
          {
            value: "harness:codex",
            label: "Codex",
            icon: (
              <AcpAgentLogo
                agentId="codex-acp"
                title="Codex"
                className="h-4 w-4"
              />
            ),
            selected: selectedHarness === "codex",
          },
          {
            value: "harness:claude",
            label: "Claude",
            icon: (
              <AcpAgentLogo
                agentId="claude-acp"
                title="Claude"
                className="h-4 w-4"
              />
            ),
            selected: selectedHarness === "claude",
          },
          {
            value: "harness:gemini",
            label: "Gemini",
            icon: (
              <AcpAgentLogo
                agentId="gemini"
                title="Gemini"
                className="h-4 w-4"
              />
            ),
            selected: selectedHarness === "gemini",
          },
        ],
      },
      {
        id: "model",
        label: (
          <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">
            Model
          </span>
        ),
        options: modelOptions.map((model) => {
          const selected = selectedModel === model.value;
          return {
            value: `model:${model.value}`,
            label: model.label,
            selected,
            ...(selectedHarness === "codex" && selected
              ? {
                  hasSubmenu: true,
                  submenuLabel: "Effort",
                  submenuSections: effortSections,
                }
              : {}),
          };
        }),
      },
    ];
  }, [selectedEffort, selectedHarness, selectedModel]);
  const selectedModelLabel =
    modelSections
      .find((section) => section.id === "model")
      ?.options.find((option) => option.value === `model:${selectedModel}`)
      ?.label ?? "GPT-5.5";
  const selectedHarnessName =
    selectedHarness === "claude"
      ? "Claude"
      : selectedHarness === "gemini"
        ? "Gemini"
        : "Codex";

  const handleModelChange = (value: string) => {
    if (value.startsWith("effort:")) {
      setSelectedEffort(value.slice("effort:".length));
      return;
    }
    if (value.startsWith("harness:")) {
      const nextHarness = value.slice("harness:".length);
      setSelectedHarness(nextHarness);
      setSelectedModel(
        nextHarness === "claude"
          ? "sonnet-4.6"
          : nextHarness === "gemini"
            ? "3.5-flash"
            : "gpt-5.5",
      );
      return;
    }
    setSelectedModel(
      value.startsWith("model:") ? value.slice("model:".length) : value,
    );
  };

  return (
    <main className="min-h-screen bg-warm-bg px-10 py-8 text-foreground">
      <section
        className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col overflow-hidden rounded-[28px] border border-warm-border bg-background shadow-2xl"
        data-chat-surface="main"
      >
        <header className="clash-copilot-panel-header flex h-[38px] shrink-0 items-center px-4">
          <h1 className="truncate text-sm font-medium">列出画布上的节点。</h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="chat-turn-frame mx-auto flex min-h-full w-full max-w-3xl min-w-0 flex-col gap-3 py-6"
            data-chat-column="turns"
          >
            <RuntimeSessionTimeline
              store={previewStore}
              agentId="codex-acp"
              mentionableNodes={[]}
              clashEntities={[]}
            />
          </div>
        </div>
        <div
          className="chat-composer-frame mx-auto w-full max-w-3xl min-w-0 space-y-2"
          data-chat-column="composer"
        >
          <ChatInput
            input={draft}
            onInputChange={setDraft}
            onSubmit={() => setDraft("")}
            onOpenAssetPicker={() =>
              setDraft(
                (current) =>
                  current || "@[Preview asset](project-asset:preview) ",
              )
            }
            toolbarAccessory={
              <Button
                variant={null}
                size={null}
                shape={null}
                className="inline-flex h-7 min-h-7 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-xs font-medium text-content-secondary shadow-none hover:bg-warm-hover"
                aria-label="Permission mode"
                onClick={() =>
                  setPermissionMode((current) =>
                    current === "full" ? "default" : "full",
                  )
                }
              >
                <ShieldWarning className="h-4 w-4" />
                <span>
                  {permissionMode === "full" ? "Full access" : "Default"}
                </span>
                <CaretDown className="h-3.5 w-3.5" />
              </Button>
            }
            rightToolbarAccessory={
              <SelectMenu
                className="relative flex justify-start"
                triggerClassName="max-w-full text-left"
                value={selectedModel}
                sections={modelSections}
                onValueChange={handleModelChange}
                ariaLabel="Model"
                title={`${selectedHarnessName} · ${selectedModelLabel}`}
                variant="inline"
                placement="top"
                menuWidth={280}
                maxMenuHeight={420}
                submenuWidth={220}
                stopPropagation
                triggerPrefix={
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-700">
                    <AcpAgentLogo
                      agentId={`${selectedHarness}-acp`}
                      title={selectedHarnessName}
                      className="h-4 w-4"
                    />
                  </span>
                }
                triggerLabel={
                  selectedHarness === "codex"
                    ? `${selectedModelLabel} ${selectedEffort.replace("-", " ")}`
                    : selectedModelLabel
                }
              />
            }
          />
        </div>
      </section>
    </main>
  );
}
