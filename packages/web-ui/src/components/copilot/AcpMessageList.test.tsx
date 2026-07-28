// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ByoMessage } from "@clash/web-ui/lib/acpEvents";

import { AcpMessageList, AcpProgressPanel, getAcpGlobalState } from "./AcpMessageList";

vi.mock("streamdown", () => ({
  Streamdown: ({ children, className }: { children: string; className?: string }) => (
    <div data-testid="streamdown" className={className}>{children}</div>
  ),
}));

describe("AcpMessageList", () => {
  afterEach(() => cleanup());

  it("renders Codex commentary as an ordinary assistant reply, not a reasoning row", () => {
    const messages: ByoMessage[] = [{
      id: "asst-commentary",
      role: "assistant",
      parts: [{
        type: "text",
        phase: "commentary",
        text: "我先看一下当前画布，避免重复已有内容。",
      }],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.getByText("我先看一下当前画布，避免重复已有内容。")).toBeTruthy();
    expect(screen.queryByTestId("acp-commentary-row")).toBeNull();
    expect(screen.queryByTestId("acp-event-icon")).toBeNull();
    expect(screen.getByTestId("acp-assistant-body")).toBeTruthy();
  });

  it("shows only the latest Codex thought while its turn is streaming", () => {
    const messages: ByoMessage[] = [{
      id: "asst-codex-live",
      role: "assistant",
      parts: [
        { type: "thought", text: "**Planning genre exploration**" },
        {
          type: "tool_call",
          toolCallId: "canvas-list",
          title: "List Canvas",
          status: "completed",
        },
        { type: "thought", text: "**Requesting clarification**" },
      ],
    }];

    render(<AcpMessageList messages={messages} agentId="codex-acp" isStreaming />);

    expect(screen.getAllByTestId("acp-thought-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /思考中/ }));
    expect(screen.queryByText("**Planning genre exploration**")).toBeNull();
    expect(screen.getByText("**Requesting clarification**")).toBeTruthy();
    expect(within(screen.getByTestId("acp-thought-details")).getByTestId("streamdown")).toBeTruthy();
  });

  it("keeps the active Codex thought below newer content in the current turn", () => {
    const messages: ByoMessage[] = [{
      id: "asst-codex-live-order",
      role: "assistant",
      parts: [
        { type: "thought", text: "Adding text node for clarity" },
        { type: "text", text: "当前 Main Canvas 为空，我先写入文本方案。" },
      ],
    }];

    render(<AcpMessageList messages={messages} agentId="codex-acp" isStreaming />);

    const prose = screen.getByText("当前 Main Canvas 为空，我先写入文本方案。");
    const thought = screen.getByTestId("acp-thought-row");
    expect(prose.compareDocumentPosition(thought) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides completed Codex thoughts but preserves other harness thought timelines", () => {
    const messages: ByoMessage[] = [{
      id: "asst-complete-thought",
      role: "assistant",
      parts: [
        { type: "thought", text: "Private completed thought" },
        { type: "text", text: "Visible answer" },
      ],
    }];

    const { rerender } = render(
      <AcpMessageList messages={messages} agentId="codex-acp" isStreaming={false} />,
    );
    expect(screen.queryByTestId("acp-thought-row")).toBeNull();
    expect(screen.getByText("Visible answer")).toBeTruthy();

    rerender(<AcpMessageList messages={messages} agentId="claude-agent-acp" isStreaming={false} />);
    expect(screen.getByTestId("acp-thought-row")).toBeTruthy();
  });

  it("renders ACP tools as Backchat-style inline event rows with expandable details", () => {
    const messages: ByoMessage[] = [{
      id: "asst-turn",
      role: "assistant",
      parts: [
        { type: "thought", text: "先读取当前画布结构。" },
        {
          type: "tool_call",
          toolCallId: "tool-list-canvas",
          title: "List canvas nodes",
          kind: "list",
          status: "completed",
          rawInput: { query: "canvas.nodes" },
          rawOutput: [
            { id: "dianmwa7", type: "action-badge", label: "Image Prompt" },
            { id: "lrcleamx", type: "image", label: "生成类似的" },
          ],
        },
        {
          type: "text",
          text: "画布上当前有 2 个节点：\n\n- `dianmwa7` — action-badge\n- `lrcleamx` — image",
        },
      ],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.getByText("已思考")).toBeTruthy();
    expect(screen.getByTestId("acp-thought-row").className).not.toContain("rounded");
    expect(screen.getByTestId("acp-thought-row").className).not.toContain("bg-");
    expect(screen.getByTestId("acp-thought-row").className).toContain("my-1");
    expect(screen.getByTestId("acp-thought-row").className).toContain("w-full");
    expect(screen.getAllByTestId("acp-event-icon").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByTestId("acp-event-icon")[0].className).toContain("w-5");
    expect(screen.getAllByTestId("acp-event-icon")[0].className).toContain("justify-center");
    expect(screen.getByText("已列出")).toBeTruthy();
    expect(within(screen.getByTestId("acp-tool-row")).getByText("List canvas nodes")).toBeTruthy();
    expect(screen.getByText(/画布上当前有 2 个节点/)).toBeTruthy();
    expect(screen.getByTestId("acp-tool-row").className).not.toContain("bg-neutral-100");
    expect(screen.getByTestId("acp-tool-row").className).not.toContain("radial-gradient");
    expect(screen.getByTestId("acp-tool-row").className).not.toContain("rounded");
    expect(screen.getByTestId("acp-tool-row").className).not.toContain("rounded-2xl");
    expect(screen.getByTestId("acp-tool-row").className).toContain("w-full");
    const toolTriggerClasses = screen.getByRole("button", { name: /已列出.*List canvas nodes/ }).className.split(/\s+/);
    expect(toolTriggerClasses).toContain("inline-flex");
    expect(toolTriggerClasses).toContain("max-w-full");
    expect(toolTriggerClasses).not.toContain("w-full");
    expect(screen.getByTestId("streamdown").className).toContain("text-[#05070d]");
    expect(screen.getByTestId("streamdown").className).toContain("leading-[1.55]");
    expect(screen.getByTestId("streamdown").className).toContain("[&>*+*]:!mt-1.5");
    expect(screen.getByTestId("streamdown").className).toContain("[&_code]:!font-sans");
    expect(screen.getByTestId("streamdown").className).toContain("[&_code]:!bg-transparent");
    expect(screen.getByTestId("streamdown").className).toContain("[&_code]:!rounded-none");
    expect(screen.getByTestId("acp-assistant-body").className).toContain("max-w-[min(64rem,100%)]");
    expect(screen.getByTestId("acp-assistant-message-content").className).toContain("w-full");
    expect(screen.queryByText("先读取当前画布结构。")).toBeNull();
    expect(screen.queryByText(/"canvas\.nodes"/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /已思考/ }));
    expect(screen.getByText("先读取当前画布结构。")).toBeTruthy();
    expect(screen.getByTestId("acp-thought-details").className).toContain("bg-transparent");
    expect(screen.getByTestId("acp-thought-details").className).toContain("w-full");
    expect(screen.getByTestId("acp-thought-details").className).not.toContain("ml-7");
    expect(screen.getByTestId("acp-thought-details").className).not.toContain("rounded");

    fireEvent.click(screen.getByRole("button", { name: /已列出.*List canvas nodes/ }));

    expect(screen.getByText(/"canvas\.nodes"/)).toBeTruthy();
    expect(screen.getByTestId("acp-tool-details").className).toContain("bg-transparent");
    expect(screen.getByTestId("acp-tool-details").className).not.toContain("rounded");
    expect(screen.getAllByText(/dianmwa7/).length).toBeGreaterThanOrEqual(2);
  });

  it("uses the Clash product renderer only for the bundled Clash MCP", () => {
    const messages: ByoMessage[] = [{
      id: "asst-clash-mcp",
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          toolCallId: "clash-canvas-open",
          title: "mcp.clash.clash_canvas_open",
          kind: "execute",
          status: "completed",
          rawInput: {
            server: "clash",
            tool: "clash_canvas_open",
            arguments: { cwd: "/Users/me/.clash/projects/demo" },
          },
          rawOutput: {
            result: {
              content: [{ type: "text", text: "Opened Clash Canvas with 3 nodes." }],
              structuredContent: { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] },
            },
          },
          mcp: {
            serverName: "clash",
            toolName: "clash_canvas_open",
            renderer: "product",
          },
          meta: {
            "clash.host_trusted_mcp": true,
          },
        },
        {
          type: "tool_call",
          toolCallId: "third-party-mcp",
          title: "mcp.charts.show_sales",
          kind: "execute",
          status: "completed",
          rawInput: {
            server: "charts",
            tool: "show_sales",
            arguments: {},
          },
          rawOutput: { result: { content: [{ type: "text", text: "Chart ready" }] } },
          mcp: {
            serverName: "charts",
            toolName: "show_sales",
          },
        },
        {
          type: "tool_call",
          toolCallId: "spoofed-clash-mcp",
          title: "mcp.clash.clash_canvas_delete",
          status: "completed",
          mcp: {
            serverName: "clash",
            toolName: "clash_canvas_delete",
            renderer: "product",
          },
        },
      ],
    }];

    render(<AcpMessageList messages={messages} />);

    const clashBlock = screen.getByTestId("clash-mcp-block");
    expect(clashBlock.textContent).toContain("Open Canvas");
    expect(clashBlock.textContent).toContain("3 nodes");
    expect(
      within(clashBlock)
        .getByTestId("clash-product-icon")
        .querySelector('[data-project-surface-icon="canvas"]'),
    ).toBeTruthy();
    expect(screen.getAllByTestId("clash-mcp-block")).toHaveLength(1);
    expect(screen.getAllByTestId("acp-tool-row")).toHaveLength(2);
    expect(screen.getByText("mcp.charts.show_sales")).toBeTruthy();
    expect(screen.getByText("mcp.clash.clash_canvas_delete")).toBeTruthy();
  });

  it("keeps a successful bundled Clash MCP result available in its product disclosure", () => {
    const messages: ByoMessage[] = [{
      id: "asst-clash-result",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "clash-canvas-snapshot",
        title: "mcp.clash.clash_canvas_snapshot",
        kind: "execute",
        status: "completed",
        rawInput: {
          server: "clash",
          tool: "clash_canvas_snapshot",
          arguments: { canvasId: "main" },
        },
        rawOutput: {
          result: {
            content: [{ type: "text", text: "Canvas snapshot is ready." }],
            structuredContent: {
              canvasId: "main",
              revision: 12,
              status: "ready",
            },
          },
        },
        content: [{
          type: "content",
          content: { type: "text", text: "Tool call completed." },
        }],
        mcp: {
          serverName: "clash",
          toolName: "clash_canvas_snapshot",
          renderer: "product",
        },
        meta: {
          "clash.host_trusted_mcp": true,
        },
      }],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.queryByTestId("clash-mcp-result")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Refresh Canvas/ }));

    const result = screen.getByTestId("clash-mcp-result");
    expect(result.textContent).toContain("Canvas snapshot is ready.");
    expect(result.textContent).toContain("Status");
    expect(result.textContent).toContain("ready");
    expect(result.textContent).toContain("Revision");
    expect(result.textContent).toContain("12");
    expect(result.textContent).not.toContain("structuredContent");
    expect(result.textContent).not.toContain("Tool call completed.");
  });

  it("renders unknown bundled Clash MCP structured results as readable facts", () => {
    const messages: ByoMessage[] = [{
      id: "asst-clash-workspace-doctor",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "clash-workspace-doctor",
        title: "mcp.clash.clash_workspace_doctor",
        kind: "execute",
        status: "completed",
        rawInput: {
          server: "clash",
          tool: "clash_workspace_doctor",
          arguments: {},
        },
        rawOutput: {
          result: {
            content: [{ type: "text", text: "Workspace checks passed." }],
            structuredContent: {
              ready: true,
              profile: "self-host",
              checks: ["project", "mcp", "storage"],
              connection: {
                status: "connected",
                latencyMs: 18,
              },
            },
          },
        },
        mcp: {
          serverName: "clash",
          toolName: "clash_workspace_doctor",
          renderer: "product",
        },
        meta: {
          "clash.host_trusted_mcp": true,
        },
      }],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.queryByText("Workspace checks passed.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Workspace Doctor/ }));

    const result = screen.getByTestId("clash-mcp-result");
    expect(result.textContent).toContain("Workspace checks passed.");
    expect(result.textContent).toContain("Ready");
    expect(result.textContent).toContain("Yes");
    expect(result.textContent).toContain("Profile");
    expect(result.textContent).toContain("self-host");
    expect(result.textContent).toContain("Checks");
    expect(result.textContent).toContain("3 items");
    expect(result.textContent).toContain("Connection Status");
    expect(result.textContent).toContain("connected");
    expect(result.textContent).toContain("Connection Latency");
    expect(result.textContent).toContain("18");
    expect(result.textContent).not.toContain("structuredContent");
    expect(result.textContent).not.toContain('{"ready"');
  });

  it("keeps a failed bundled Clash MCP error payload available in its disclosure", () => {
    const messages: ByoMessage[] = [{
      id: "asst-clash-failure",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "clash-canvas-read",
        title: "mcp.clash.clash_canvas_read",
        kind: "execute",
        status: "failed",
        rawInput: {
          arguments: { canvasId: "main", nodeId: "missing-node" },
        },
        rawOutput: {
          error: {
            code: "NOT_FOUND",
            message: "Canvas node was not found.",
          },
        },
        mcp: {
          serverName: "clash",
          toolName: "clash_canvas_read",
          renderer: "product",
        },
        meta: {
          "clash.host_trusted_mcp": true,
        },
      }],
    }];

    render(<AcpMessageList messages={messages} />);

    fireEvent.click(screen.getByRole("button", { name: /Canvas Read/ }));
    const result = screen.getByTestId("clash-mcp-result");
    expect(result.textContent).toContain("Canvas node was not found.");
    expect(result.textContent).toContain("Error Code");
    expect(result.textContent).toContain("NOT_FOUND");
  });

  it("renders a bundled Canvas list as an inline tool event with a navigable Canvas result", () => {
    const onOpenClashEntity = vi.fn();
    const messages: ByoMessage[] = [{
      id: "asst-clash-canvas-list",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "clash-canvas-list",
        title: "mcp.clash.clash_canvas_list",
        kind: "execute",
        status: "completed",
        rawInput: {
          server: "clash",
          tool: "clash_canvas_list",
          arguments: {
            canvasId: "main",
            cwd: "/Users/me/.clash/projects/demo",
          },
        },
        rawOutput: {
          result: {
            content: [{ type: "text", text: "[]" }],
            structuredContent: { items: [] },
            _meta: null,
          },
          error: null,
        },
        mcp: {
          serverName: "clash",
          toolName: "clash_canvas_list",
          renderer: "product",
        },
        meta: {
          "clash.host_trusted_mcp": true,
        },
      }],
    }];

    render(
      <AcpMessageList
        messages={messages}
        onOpenClashEntity={onOpenClashEntity}
      />,
    );

    const block = screen.getByTestId("clash-mcp-block");
    expect(block.className).toContain("my-1");
    expect(block.className).toContain("w-full");
    expect(block.className).not.toContain("rounded");
    expect(block.className).not.toContain("border");
    expect(block.className).not.toContain("bg-[");

    const trigger = screen.getByRole("button", { name: /List Canvas/ });
    const triggerClasses = trigger.className.split(/\s+/);
    expect(triggerClasses).toContain("max-w-full");
    expect(triggerClasses).not.toContain("w-full");
    expect(triggerClasses).toContain("group/acp-event");
    expect(screen.getByTestId("clash-product-icon").className).toContain("w-5");

    fireEvent.click(trigger);

    const canvasResult = screen.getByRole("button", { name: /Open Canvas Main/ });
    expect(
      canvasResult.querySelector('[data-project-surface-icon="canvas"]'),
    ).toBeTruthy();
    expect(canvasResult.textContent).toContain("Main");
    expect(canvasResult.textContent).toContain("Canvas");
    expect(canvasResult.textContent).toContain("0 nodes");
    expect(block.textContent).not.toContain("/Users/me/.clash/projects/demo");
    expect(block.textContent).not.toContain('"canvasId"');
    expect(block.textContent).not.toContain("[]");

    fireEvent.click(canvasResult);
    expect(onOpenClashEntity).toHaveBeenCalledWith({
      kind: "canvas",
      id: "main",
      label: "Main",
    });
  });

  it("scopes event icon hover styles to the row being hovered", () => {
    const messages: ByoMessage[] = [{
      id: "asst-hover-scope",
      role: "assistant",
      parts: [
        { type: "thought", text: "Inspect the project." },
        {
          type: "tool_call",
          toolCallId: "tool-pwd",
          title: "pwd",
          kind: "execute",
          status: "completed",
          rawInput: { command: "pwd" },
          rawOutput: "/tmp/project",
        },
        {
          type: "tool_call",
          toolCallId: "clash-canvas-list",
          title: "mcp.clash.clash_canvas_list",
          kind: "execute",
          status: "completed",
          rawInput: {
            arguments: { canvasId: "main", cwd: "/tmp/project" },
          },
          rawOutput: {
            result: {
              content: [{ type: "text", text: "[]" }],
              structuredContent: { items: [] },
            },
          },
          mcp: {
            serverName: "clash",
            toolName: "clash_canvas_list",
            renderer: "product",
          },
          meta: {
            "clash.host_trusted_mcp": true,
          },
        },
      ],
    }];

    render(<AcpMessageList messages={messages} />);

    for (const icon of screen.getAllByTestId("acp-event-icon")) {
      expect(icon.className).toContain("group-hover/acp-event:");
      expect(icon.className).not.toContain("group-hover:text");
    }
    expect(screen.getByTestId("clash-product-icon").className).toContain(
      "group-hover/acp-event:",
    );
  });

  it("turns returned Assets, Timelines, and Director Stages into project entity actions", () => {
    const onOpenClashEntity = vi.fn();
    const trustedMcp = {
      serverName: "clash",
      renderer: "product" as const,
    };
    const trustedMeta = { "clash.host_trusted_mcp": true };
    const messages: ByoMessage[] = [{
      id: "asst-project-entities",
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          toolCallId: "assets",
          title: "mcp.clash.clash_cli_assets",
          status: "completed",
          rawInput: { arguments: { args: ["list", "--json"] } },
          rawOutput: {
            result: {
              content: [{ type: "text", text: "[{\"id\":\"asset-1\"}]" }],
              structuredContent: { items: [{ id: "asset-1", name: "Hero Still" }] },
            },
          },
          mcp: { ...trustedMcp, toolName: "clash_cli_assets" },
          meta: trustedMeta,
        },
        {
          type: "tool_call",
          toolCallId: "timeline",
          title: "mcp.clash.clash_cli_timeline",
          status: "completed",
          rawInput: {
            arguments: { args: ["get", "--timeline", "timeline-1", "--json"] },
          },
          rawOutput: {
            result: {
              content: [{ type: "text", text: "{}" }],
              structuredContent: { id: "timeline-1" },
            },
          },
          mcp: { ...trustedMcp, toolName: "clash_cli_timeline" },
          meta: trustedMeta,
        },
        {
          type: "tool_call",
          toolCallId: "director",
          title: "mcp.clash.clash_cli_director",
          status: "completed",
          rawInput: {
            arguments: { args: ["get", "--stage", "stage-1", "--json"] },
          },
          rawOutput: {
            result: {
              content: [{ type: "text", text: "{}" }],
              structuredContent: { id: "stage-1" },
            },
          },
          mcp: { ...trustedMcp, toolName: "clash_cli_director" },
          meta: trustedMeta,
        },
      ],
    }];

    render(
      <AcpMessageList
        messages={messages}
        defaultOpenTools
        clashEntities={[
          { kind: "asset", id: "asset-1", label: "Hero Still" },
          { kind: "timeline", id: "timeline-1", label: "Final Cut" },
          { kind: "director-stage", id: "stage-1", label: "Kitchen Scene" },
        ]}
        onOpenClashEntity={onOpenClashEntity}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Asset Hero Still" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Timeline Final Cut" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Director Stage Kitchen Scene" }));

    expect(onOpenClashEntity.mock.calls.map(([entity]) => entity)).toEqual([
      { kind: "asset", id: "asset-1", label: "Hero Still" },
      { kind: "timeline", id: "timeline-1", label: "Final Cut" },
      { kind: "director-stage", id: "stage-1", label: "Kitchen Scene" },
    ]);
    expect(screen.queryByText(/--timeline/)).toBeNull();
    expect(screen.queryByText(/structuredContent/)).toBeNull();
  });

  it("labels failed generic ACP tool events as failures instead of completed calls", () => {
    const messages: ByoMessage[] = [{
      id: "asst-mcp-startup-failure",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "mcp_startup.clash",
        title: "mcp__clash__startup",
        kind: "other",
        status: "failed",
        content: [{
          type: "content",
          content: {
            type: "text",
            text: "MCP server `clash` failed to start",
          },
        }],
      }],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(
      screen.getByRole("button", { name: /调用失败.*mcp__clash__startup/ }),
    ).toBeTruthy();
    expect(screen.queryByText("已调用")).toBeNull();
  });

  it("renders Codex commentary and final answers as ordinary answer prose", () => {
    const messages: ByoMessage[] = [{
      id: "asst-phases",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "I am checking the lifecycle.",
          messageId: "commentary-1",
          phase: "commentary",
        },
        {
          type: "text",
          text: "The lifecycle is fixed.",
          messageId: "final-1",
          phase: "final_answer",
        },
      ],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.queryByTestId("acp-commentary-row")).toBeNull();
    expect(screen.queryByTestId("acp-event-icon")).toBeNull();
    expect(screen.getAllByTestId("acp-assistant-body").map((node) => node.textContent)).toEqual([
      "I am checking the lifecycle.",
      "The lifecycle is fixed.",
    ]);
  });

  it("keeps plan and permission out of the message stream and exposes plan for global progress", () => {
    const messages: ByoMessage[] = [{
      id: "asst-plan",
      role: "assistant",
      parts: [
        {
          type: "plan",
          entries: [
            { content: "Inspect canvas nodes", status: "completed" },
            { content: "Summarize nodes", status: "in_progress" },
          ],
        },
        {
          type: "tool_call",
          toolCallId: "permission-read",
          title: "Read selected canvas context",
          kind: "permission",
          status: "pending",
        },
        {
          type: "tool_call",
          toolCallId: "tool-list",
          title: "List canvas nodes",
          kind: "list",
          status: "completed",
          rawOutput: [{ id: "node-1" }],
        },
        {
          type: "event_note",
          title: "Turn complete",
          tone: "neutral",
        },
      ],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.queryByText("Inspect canvas nodes")).toBeNull();
    expect(screen.queryByText("Read selected canvas context")).toBeNull();
    expect(screen.getByText("Turn complete")).toBeTruthy();
    expect(screen.getByTestId("acp-event-row").className).not.toContain("rounded");
    expect(screen.getByTestId("acp-event-row").className).not.toContain("bg-");
    expect(screen.getByTestId("acp-event-row").className).not.toContain("border");
    expect(screen.getByTestId("acp-event-row").className).toContain("w-full");
    expect(screen.getByTestId("acp-event-row").className).not.toContain("max-w-[min(44rem,100%)]");

    cleanup();

    const globalState = getAcpGlobalState(messages);
    render(<AcpProgressPanel planEntries={globalState.planEntries} outputs={globalState.outputs} />);
    expect(screen.getByRole("button", { name: /toggle progress/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /toggle progress/i }));
    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("Summarize nodes")).toBeTruthy();
    expect(screen.getByText("Outputs")).toBeTruthy();
    expect(screen.getByText("List canvas nodes")).toBeTruthy();
  });

  it("renders diagnostics as an inline warning instead of a tool-like disclosure", () => {
    const messages: ByoMessage[] = [{
      id: "asst-warning",
      role: "assistant",
      parts: [{
        type: "event_note",
        title: "Skill context limited",
        detail: "Warning: Skill descriptions were shortened to fit the 2% skills context budget.",
        tone: "warning",
      }],
    }];

    render(<AcpMessageList messages={messages} />);

    const warning = screen.getByRole("alert");
    expect(warning.getAttribute("data-testid")).toBe("acp-warning-row");
    expect(within(warning).getByTestId("acp-warning-icon")).toBeTruthy();
    expect(within(warning).getByText("Skill context limited")).toBeTruthy();
    expect(screen.getByText(/Warning: Skill descriptions/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Skill context limited/ })).toBeNull();
    expect(warning.className).not.toContain("rounded");
    expect(warning.className).not.toContain("border");
    expect(warning.className).not.toContain("bg-");

    fireEvent.click(within(warning).getByRole("button", { name: "Dismiss warning" }));
    expect(screen.queryByTestId("acp-warning-row")).toBeNull();
  });

  it("summarizes shell tool details instead of exposing raw ACP JSON", () => {
    const messages: ByoMessage[] = [{
      id: "asst-shell",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "tool-pwd",
        title: "pwd",
        kind: "execute",
        status: "completed",
        rawInput: {
          started_at_ms: 1781587289565,
          command: ["/bin/zsh", "-lc", "pwd"],
          cwd: "/Users/xiaoyang/.clash/projects/dcf4f3a0-dbc0-4482-9a15-5cfad33a4716",
          parsed_cmd: [{ type: "unknown", cmd: "pwd" }],
          source: "unified_exec_startup",
        },
        rawOutput: {
          source: "unified_exec_startup",
          stdout: "/Users/xiaoyang/.clash/projects/dcf4f3a0-dbc0-4482-9a15-5cfad33a4716\n",
          stderr: "",
          aggregated_output: "/Users/xiaoyang/.clash/projects/dcf4f3a0-dbc0-4482-9a15-5cfad33a4716\n",
        },
      }],
    }];

    render(<AcpMessageList messages={messages} />);
    fireEvent.click(screen.getByRole("button", { name: /Ran pwd/ }));

    const details = screen.getByTestId("acp-tool-details");
    expect(details.className).toContain("w-full");
    expect(details.className).not.toContain("ml-7");
    expect(screen.getByTestId("acp-shell-details").className).toContain("w-full");
    expect(details.textContent).toContain("Shell");
    expect(details.textContent).toContain("$ pwd");
    expect(details.textContent).toContain("/Users/xiaoyang/.clash/projects/dcf4f3a0-dbc0-4482-9a15-5cfad33a4716");
    expect(details.textContent).not.toContain("started_at_ms");
    expect(details.textContent).not.toContain("parsed_cmd");
    expect(details.textContent).not.toContain("aggregated_output");
    expect(details.textContent).not.toContain("unified_exec_startup");
  });

  it("auto-opens tool details when streaming output arrives after an empty pending tool", () => {
    const pendingMessages: ByoMessage[] = [{
      id: "asst-streaming-tool",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "tool-streaming",
        title: "List models",
        kind: "list",
        status: "pending",
      }],
    }];
    const completedMessages: ByoMessage[] = [{
      id: "asst-streaming-tool",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "tool-streaming",
        title: "List models",
        kind: "list",
        status: "completed",
        rawOutput: ["nano-banana", "flux-schnell"],
      }],
    }];

    const { rerender } = render(
      <AcpMessageList messages={pendingMessages} defaultOpenTools />,
    );

    expect(screen.queryByTestId("acp-tool-details")).toBeNull();

    rerender(<AcpMessageList messages={completedMessages} defaultOpenTools />);

    expect(screen.getByTestId("acp-tool-details").textContent).toContain("nano-banana");
    expect(screen.getByTestId("acp-tool-details").textContent).toContain("flux-schnell");
  });

  it("renders Claude non-executed tool metadata as a visible disposition", () => {
    const messages: ByoMessage[] = [{
      id: "asst-claude-nonexecution",
      role: "assistant",
      parts: [{
        type: "tool_call",
        toolCallId: "tool-rejected",
        title: "Edit notes.md",
        kind: "edit",
        status: "failed",
        meta: {
          claudeCode: {
            toolName: "Edit",
            nonExecutionKind: "user-rejected",
            userFeedback: "Use a different file.",
          },
        },
      }],
    }];

    render(<AcpMessageList messages={messages} defaultOpenTools />);

    expect(screen.getByRole("button", { name: /未执行.*Edit notes\.md/ })).toBeTruthy();
    expect(screen.getByTestId("acp-tool-nonexecution").textContent).toContain("user-rejected");
    expect(screen.getByTestId("acp-tool-nonexecution").textContent).toContain("Use a different file.");
  });

  it("deduplicates Codex exec_command shell echoes into one Backchat-style command row", () => {
    const cwd = "/Users/xiaoyang/.clash/projects/dcf4f3a0-dbc0-4482-9a15-5cfad33a4716";
    const messages: ByoMessage[] = [{
      id: "asst-duplicate-shell",
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          toolCallId: "tool-exec-command",
          title: "exec_command",
          toolName: "exec_command",
          status: "completed",
          rawInput: {
            cmd: "pwd",
            workdir: cwd,
            yield_time_ms: 10000,
            max_output_tokens: 2000,
          },
          rawOutput: `Chunk ID: aa91d9\nWall time: 0.0002 seconds\nProcess exited with code 0\nOriginal token count: 19\nOutput:\n${cwd}\n`,
        },
        {
          type: "tool_call",
          toolCallId: "tool-pwd",
          title: "pwd",
          kind: "execute",
          status: "completed",
          rawInput: {
            command: ["/bin/zsh", "-lc", "pwd"],
            cwd,
          },
          rawOutput: {
            stdout: `${cwd}\n`,
            exit_code: 0,
          },
        },
      ],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.getAllByRole("button", { name: /Ran pwd/ })).toHaveLength(1);
    expect(screen.queryByText("exec_command")).toBeNull();
    expect(screen.queryByText(/"cmd"/)).toBeNull();
    expect(screen.queryByText(/Chunk ID/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ran pwd/ }));

    expect(screen.getByTestId("acp-shell-details").textContent).toContain("$ pwd");
    expect(screen.getByTestId("acp-shell-details").textContent).toContain(cwd);
  });

  it("groups consecutive shell commands as a Backchat-style command summary", () => {
    const messages: ByoMessage[] = [{
      id: "asst-shell-group",
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          toolCallId: "tool-ps",
          title: "exec_command",
          toolName: "exec_command",
          status: "completed",
          rawInput: {
            cmd: "ps -axo pid,ppid,pgid,stat,command | rg 'Electron.app/Contents/MacOS/Electron|vite.*3001|codex-acp'",
          },
          rawOutput: {
            stdout: "72781 92710 72781 Ss /bin/zsh -lc ps -axo pid,ppid,pgid,stat,command\n",
            exit_code: 0,
          },
        },
        {
          type: "tool_call",
          toolCallId: "tool-diff",
          title: "exec_command",
          toolName: "exec_command",
          status: "completed",
          rawInput: {
            cmd: "git diff -- packages/web-ui/src/components/ChatbotCopilot.tsx packages/web-ui/src/components/copilot/AcpMessageList.tsx",
          },
          rawOutput: {
            stdout: "diff --git a/packages/web-ui/src/components/ChatbotCopilot.tsx b/packages/web-ui/src/components/ChatbotCopilot.tsx\n",
            exit_code: 0,
          },
        },
      ],
    }];

    render(<AcpMessageList messages={messages} />);

    expect(screen.getByRole("button", { name: /Ran 2 commands/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ran ps -axo/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ran 2 commands/ }));

    expect(screen.getByRole("button", { name: /Ran ps -axo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ran git diff/ })).toBeTruthy();
    expect(screen.getByTestId("acp-shell-details").textContent).toContain("Shell");
    expect(screen.getByTestId("acp-shell-details").textContent).toContain("$ ps -axo");
  });
});
