import type { ByoMessage } from "@clash/web-ui/lib/acpEvents";
import { AcpMessageList, AcpProgressPanel, getAcpGlobalState } from "@clash/web-ui/components/copilot/AcpMessageList";
import { AcpAgentLogo } from "@clash/web-ui/components/copilot/AcpAgentLogo";
import { SelectMenu, type SelectSection } from "@clash/web-ui/components/ui/select";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowUp, CaretDown, Microphone, Plus, ShieldWarning } from "@phosphor-icons/react";

const messages: ByoMessage[] = [
  {
    id: "user-list-canvas",
    role: "user",
    parts: [{ type: "text", text: "列出画布上的节点。" }],
  },
  {
    id: "assistant-list-canvas",
    role: "assistant",
    parts: [
      { type: "thought", text: "先确认画布状态，再把节点按类型整理出来。" },
      {
        type: "plan",
        entries: [
          { content: "读取当前画布节点", status: "completed" },
          { content: "核对图片和动作节点的元数据", status: "completed" },
          { content: "用可读格式汇总节点", status: "in_progress" },
        ],
      },
      {
        type: "tool_call",
        toolCallId: "tool-list-canvas",
        title: "List canvas nodes",
        kind: "list",
        status: "completed",
        rawInput: { query: "canvas.nodes", projectId: "mock-project" },
        rawOutput: [
          { id: "dianmwa7", type: "action-badge", label: "Image Prompt", action: "image-gen" },
          { id: "lrcleamx", type: "image", status: "completed", size: "500 x 281" },
          { id: "upload-1781414847642-oq6cbcl", type: "image", fileName: "258251d8857f30efff6b9b7085302bf5.JPG" },
        ],
      },
      {
        type: "tool_call",
        toolCallId: "permission-read-canvas",
        title: "Read selected canvas context",
        kind: "permission",
        status: "pending",
        rawInput: {
          reason: "Need selected asset metadata before referencing it in the reply.",
          locations: ["canvas://selected-assets"],
        },
      },
      {
        type: "tool_call",
        toolCallId: "tool-shell-check",
        title: "node scripts/inspect-canvas.mjs",
        kind: "execute",
        status: "completed",
        rawInput: { command: "node scripts/inspect-canvas.mjs --format=json" },
        content: [
          {
            type: "terminal",
            output: "Found 3 nodes, 1 selected asset, 0 pending renders.",
          },
        ],
      },
      {
        type: "event_note",
        title: "Turn complete",
        detail: "Usage updated by ACP session.",
      },
      {
        type: "text",
        text: [
          "画布上当前有 **3 个节点**：",
          "",
          "| ID | 类型 | 摘要 |",
          "| --- | --- | --- |",
          "| `dianmwa7` | action-badge | Image Prompt / image-gen |",
          "| `lrcleamx` | image | completed, 500 x 281 |",
          "| `upload-1781414847642-oq6cbcl` | image | 258251d8857f30efff6b9b7085302bf5.JPG |",
          "",
          "其中 `upload-1781414847642-oq6cbcl` 是当前选中的素材引用。",
        ].join("\n"),
      },
    ],
  },
];

export default function CodexCopilotPreview() {
  const [searchParams] = useSearchParams();
  const openTools = searchParams.get("open") === "1";
  const openProgress = searchParams.get("progress") === "1";
  const globalState = getAcpGlobalState(messages);
  const [selectedHarness, setSelectedHarness] = useState("codex");
  const [selectedModel, setSelectedModel] = useState("gpt-5.5");
  const [selectedEffort, setSelectedEffort] = useState("low");
  const modelSections = useMemo<SelectSection<string>[]>(() => {
    const modelOptions = selectedHarness === "claude"
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
    const effortSections: SelectSection<string>[] = [{
      id: "codex-effort",
      label: <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">Effort</span>,
      options: [
        { value: "effort:minimal", label: "Minimal", selected: selectedEffort === "minimal" },
        { value: "effort:low", label: "Low", selected: selectedEffort === "low" },
        { value: "effort:medium", label: "Medium", selected: selectedEffort === "medium" },
        { value: "effort:high", label: "High", selected: selectedEffort === "high" },
        { value: "effort:very-high", label: "Very high", selected: selectedEffort === "very-high" },
      ],
    }];
    return [
      {
        id: "harness",
        label: <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">Harness</span>,
        options: [
          {
            value: "harness:codex",
            label: "Codex",
            icon: <AcpAgentLogo agentId="codex-acp" title="Codex" className="h-4 w-4" />,
            selected: selectedHarness === "codex",
          },
          {
            value: "harness:claude",
            label: "Claude",
            icon: <AcpAgentLogo agentId="claude-acp" title="Claude" className="h-4 w-4" />,
            selected: selectedHarness === "claude",
          },
          {
            value: "harness:gemini",
            label: "Gemini",
            icon: <AcpAgentLogo agentId="gemini" title="Gemini" className="h-4 w-4" />,
            selected: selectedHarness === "gemini",
          },
        ],
      },
      {
        id: "model",
        label: <span className="text-[11px] font-semibold uppercase tracking-[0.11em]">Model</span>,
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
  const selectedModelLabel = modelSections
    .find((section) => section.id === "model")?.options
    .find((option) => option.value === `model:${selectedModel}`)?.label ?? "GPT-5.5";
  const selectedHarnessName = selectedHarness === "claude"
    ? "Claude"
    : selectedHarness === "gemini"
      ? "Gemini"
      : "Codex";

  return (
    <main className="min-h-screen bg-warm-bg px-10 py-8 text-foreground">
      <section className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col overflow-hidden rounded-[28px] border border-warm-border bg-background shadow-2xl">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-warm-border px-8">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-status-down">ACP Preview</p>
            <h1 className="text-lg font-semibold">列出画布上的节点。</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-warm-muted px-3 py-1 text-xs text-muted-foreground">
              stream: thought / tool / markdown · progress: plan / outputs
            </span>
            <AcpProgressPanel
              planEntries={globalState.planEntries}
              outputs={globalState.outputs}
              defaultOpen={openProgress}
              className="shrink-0"
            />
          </div>
        </header>
        <div className="relative flex-1 overflow-y-auto px-10 pb-32 pt-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            <AcpMessageList messages={messages} defaultOpenTools={openTools} />
          </div>
        </div>
        <div className="border-t border-warm-border/60 bg-background/95 px-10 py-5">
          <div className="mx-auto max-w-3xl rounded-2xl border border-warm-border bg-background p-3 shadow-lg">
            <div className="mb-3 min-h-10 px-2 text-sm text-muted-foreground">Ask anything about the canvas...</div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-warm-muted" aria-label="Attach">
                  <Plus className="h-4 w-4" />
                </button>
                <button className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-status-down hover:bg-status-down/10" aria-label="Permission mode">
                  <ShieldWarning className="h-4 w-4" />
                  <span>Full access</span>
                  <CaretDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <SelectMenu
                  className="relative flex justify-start"
                  triggerClassName="max-w-full text-left"
                  value={selectedModel}
                  sections={modelSections}
                  onValueChange={(value) => {
                    if (value.startsWith("effort:")) {
                      setSelectedEffort(value.slice("effort:".length));
                      return;
                    }
                    if (value.startsWith("harness:")) {
                      const nextHarness = value.slice("harness:".length);
                      setSelectedHarness(nextHarness);
                      setSelectedModel(nextHarness === "claude" ? "sonnet-4.6" : nextHarness === "gemini" ? "3.5-flash" : "gpt-5.5");
                      return;
                    }
                    if (value.startsWith("model:")) {
                      setSelectedModel(value.slice("model:".length));
                      return;
                    }
                    setSelectedModel(value);
                  }}
                  ariaLabel="Model"
                  title={`${selectedHarnessName} · ${selectedModelLabel}`}
                  variant="inline"
                  placement="top"
                  menuWidth={280}
                  maxMenuHeight={420}
                  submenuWidth={220}
                  stopPropagation
                  triggerPrefix={(
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-700">
                      <AcpAgentLogo agentId={`${selectedHarness}-acp`} title={selectedHarnessName} className="h-4 w-4" />
                    </span>
                  )}
                  triggerLabel={selectedHarness === "codex"
                    ? `${selectedModelLabel} ${selectedEffort.replace("-", " ")}`
                    : selectedModelLabel}
                />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <button className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-warm-muted" aria-label="Voice">
                  <Microphone className="h-4 w-4" />
                </button>
                <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-status-down text-white" aria-label="Send">
                  <ArrowUp className="h-4 w-4" weight="bold" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
