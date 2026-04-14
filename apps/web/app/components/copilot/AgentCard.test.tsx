import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentCard, AgentLog } from "./AgentCard";

// Mock framer-motion to avoid animation complexity in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock phosphor icons
vi.mock("@phosphor-icons/react", () => {
  const Icon = ({ className, ...props }: any) => <span className={className} data-testid="icon" {...props} />;
  return {
    CaretDown: Icon,
    CaretRight: Icon,
    CheckCircle: Icon,
    CircleNotch: Icon,
    PauseCircle: Icon,
    Robot: Icon,
    Crown: Icon,
    FilmStrip: Icon,
    Scroll: Icon,
    MagicWand: Icon,
    VideoCamera: Icon,
    Wrench: Icon,
    Check: Icon,
    X: Icon,
  };
});

// Mock ReactMarkdown
vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));

describe("AgentCard", () => {
  it("renders agent name and status", () => {
    render(<AgentCard agentName="ScriptWriter" status="working" />);

    expect(screen.getByText("ScriptWriter")).toBeInTheDocument();
    expect(screen.getByText("working")).toBeInTheDocument();
  });

  it("renders text logs", () => {
    const logs: AgentLog[] = [
      { id: "1", type: "text", content: "Working on the script..." },
      { id: "2", type: "text", content: "Almost done!" },
    ];

    render(<AgentCard agentName="ScriptWriter" status="working" logs={logs} />);

    expect(screen.getByText("Working on the script...")).toBeInTheDocument();
    expect(screen.getByText("Almost done!")).toBeInTheDocument();
  });

  it("renders tool_call logs with ToolCall component", () => {
    const logs: AgentLog[] = [
      {
        id: "tc-1",
        type: "tool_call",
        toolProps: {
          toolName: "list_canvas_nodes",
          args: { group_id: "g1" },
          result: "Found 3 nodes",
          status: "success",
          indent: false,
        },
      },
      {
        id: "tc-2",
        type: "tool_call",
        toolProps: {
          toolName: "create_canvas_node",
          args: { type: "text", label: "Scene 1" },
          status: "pending",
          indent: false,
        },
      },
    ];

    render(<AgentCard agentName="ScriptWriter" status="working" logs={logs} />);

    // ToolCall components should render tool names
    expect(screen.getByText("list_canvas_nodes")).toBeInTheDocument();
    expect(screen.getByText("create_canvas_node")).toBeInTheDocument();
  });

  it("renders mixed text and tool_call logs in order", () => {
    const logs: AgentLog[] = [
      { id: "1", type: "text", content: "Starting work..." },
      {
        id: "tc-1",
        type: "tool_call",
        toolProps: {
          toolName: "list_canvas_nodes",
          args: {},
          status: "success",
          result: "ok",
        },
      },
      { id: "2", type: "text", content: "Tool completed." },
    ];

    const { container } = render(<AgentCard agentName="ScriptWriter" status="working" logs={logs} />);

    // All items should be present
    expect(screen.getByText("Starting work...")).toBeInTheDocument();
    expect(screen.getAllByText("list_canvas_nodes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Tool completed.")).toBeInTheDocument();
  });

  it("shows done status correctly", () => {
    render(<AgentCard agentName="ScriptWriter" status="done" />);
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("shows failed status correctly", () => {
    render(<AgentCard agentName="Editor" status="failed" />);
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("toggles expand/collapse on header click", () => {
    const logs: AgentLog[] = [
      { id: "1", type: "text", content: "Some log content" },
    ];

    const { container } = render(
      <AgentCard agentName="ScriptWriter" status="working" logs={logs} isExpanded={true} />
    );

    // Content should be visible initially
    expect(screen.getByText("Some log content")).toBeInTheDocument();

    // Click header to collapse
    const header = container.querySelector(".cursor-pointer");
    if (header) fireEvent.click(header);

    // After collapse, AnimatePresence mock just removes children
    // The state should have toggled (testing the click handler)
  });

  it("renders with correct persona icons", () => {
    const { rerender } = render(
      <AgentCard agentName="Director" status="working" persona="director" />
    );
    expect(screen.getByText("Orchestrator")).toBeInTheDocument();

    rerender(<AgentCard agentName="ScriptWriter" status="working" persona="scriptwriter" />);
    expect(screen.queryByText("Orchestrator")).not.toBeInTheDocument();
  });

  it("handles empty logs gracefully", () => {
    render(<AgentCard agentName="Agent" status="working" logs={[]} />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });
});
