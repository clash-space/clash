// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AcpAgentLogo } from "./AcpAgentLogo";

describe("AcpAgentLogo", () => {
  it("renders Cursor with the registry brand icon", () => {
    render(<AcpAgentLogo agentId="cursor" />);

    const logo = screen.getByRole("img", { name: "Cursor" });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("viewBox", "0 0 466.73 532.09");
    expect(logo).toHaveAttribute("shape-rendering", "geometricPrecision");
    expect(logo).toHaveAttribute("focusable", "false");
  });

  it("renders Devin with a brand icon instead of the generic robot", () => {
    render(<AcpAgentLogo agentId="devin" />);

    const logo = screen.getByRole("img", { name: "Devin" });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("data-acp-agent-logo", "");
  });

  it("uses the official ACP registry icon for Qwen Code", () => {
    render(<AcpAgentLogo agentId="qwen-code" />);

    expect(screen.getByRole("img", { name: "Qwen Code" })).toHaveAttribute("viewBox", "0 0 141.38 140");
  });

  it("uses the OpenClaw brand mark for custom OpenClaw harness ids", () => {
    render(<AcpAgentLogo agentId="custom-openclaw-acp" />);

    expect(screen.getByRole("img", { name: "OpenClaw" })).toHaveAttribute("viewBox", "0 0 120 120");
  });
});
