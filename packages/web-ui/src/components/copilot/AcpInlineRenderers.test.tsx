// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { AgentUIToolItem } from "@openma/common/agent-ui";
import { afterEach, describe, expect, it } from "vitest";

import { AcpAssistantTextInline, AcpToolInline } from "./AcpInlineRenderers";

afterEach(cleanup);

describe("AcpInlineRenderers", () => {
  it("renders Clash Markdown only inside the assistant-text slot", () => {
    render(<AcpAssistantTextInline text="A **canonical** answer" />);

    expect(screen.getByTestId("acp-assistant-body")).toHaveTextContent(
      "A canonical answer",
    );
  });

  it("gives process copy a compact hierarchy and keeps list markers inside the answer column", () => {
    const { rerender } = render(
      <AcpAssistantTextInline
        section="process"
        text="**Planning** the next step"
      />,
    );

    expect(screen.getByTestId("acp-assistant-body")).toHaveAttribute(
      "data-assistant-section",
      "process",
    );
    expect(screen.getByTestId("acp-assistant-body")).toHaveAttribute(
      "data-chat-typography",
      "meta",
    );

    rerender(
      <AcpAssistantTextInline
        section="answer"
        text={"A useful answer:\n\n- First item\n- Second item"}
      />,
    );

    expect(screen.getByTestId("acp-assistant-body")).toHaveAttribute(
      "data-chat-typography",
      "body",
    );
    expect(screen.getByRole("list")).toHaveClass("list-outside", "pl-5");
  });

  it("renders a canonical tool entry without creating a message timeline", () => {
    const tool: AgentUIToolItem = {
      id: "tool-read",
      kind: "tool",
      title: "Read project.toml",
      toolKind: "read",
      status: "completed",
      outputs: [],
      rawInput: { path: ".clash/project.toml" },
      rawOutput: 'project = "demo"',
    };

    render(<AcpToolInline tool={tool} defaultOpen />);

    expect(screen.getByTestId("acp-tool-row")).toBeInTheDocument();
    expect(screen.getByTestId("acp-tool-details")).toHaveTextContent(
      "project.toml",
    );
    expect(screen.queryByTestId("acp-message-list")).toBeNull();
  });

  it("keeps the existing trusted Clash MCP product row as an inline tool slot", () => {
    const tool: AgentUIToolItem = {
      id: "tool-canvas",
      kind: "tool",
      title: "Open canvas",
      toolKind: "execute",
      status: "completed",
      outputs: [],
      rawInput: {
        server: "clash",
        tool: "clash_canvas_open",
        arguments: {},
      },
      rawOutput: {
        result: {
          content: [{ type: "text", text: "Opened Clash Canvas." }],
          structuredContent: { nodes: [{ id: "node-1" }] },
        },
      },
      adapterMeta: {
        is_mcp_tool_call: true,
        mcp_server_name: "clash",
        mcp_tool_name: "clash_canvas_open",
        "clash.renderer": "product",
        "clash.host_trusted_mcp": true,
      },
    };

    render(<AcpToolInline tool={tool} defaultOpen />);

    expect(screen.getByTestId("clash-mcp-block")).toBeInTheDocument();
    expect(screen.getByTestId("clash-product-icon")).toBeInTheDocument();
  });

  it("leaves permission ownership outside the tool presentation slot", () => {
    const tool: AgentUIToolItem = {
      id: "permission-1",
      kind: "tool",
      toolKind: "permission",
      status: "pending",
      outputs: [],
    };

    const { container } = render(<AcpToolInline tool={tool} />);

    expect(container).toBeEmptyDOMElement();
  });
});
