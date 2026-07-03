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
