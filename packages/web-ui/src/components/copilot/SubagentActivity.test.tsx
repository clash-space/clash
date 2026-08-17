// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SubagentActivityDock,
  SubagentActivityRow,
  SubagentDetailPanel,
  type SubagentWorkItem,
} from "./SubagentActivity";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        "copilot.subagent.activityTitle": "Subagents",
        "copilot.subagent.back": "Back to conversation",
        "copilot.subagent.close": "Close subagent details",
        "copilot.subagent.stop": "Stop",
        "copilot.subagent.stopAll": "Stop All",
        "copilot.subagent.stopAllLabel": "Stop all subagents",
        "copilot.subagent.status.running": "Working",
        "copilot.subagent.status.completed": "Completed",
        "copilot.subagent.status.failed": "Failed",
        "copilot.subagent.status.cancelled": "Cancelled",
        "copilot.subagent.status.unknown": "Status unknown",
      };
      if (key === "copilot.subagent.workingCount") return `${values?.count} Working`;
      if (key === "copilot.subagent.openTask") return `Open ${values?.title}`;
      if (key === "copilot.subagent.stopTask") return `Stop ${values?.title}`;
      return labels[key] ?? key;
    },
  }),
}));

const runningItem: SubagentWorkItem = {
  id: "child-explore",
  title: "Explore plugin architecture",
  agentType: "Explorer",
  detail: "Reviewing tests and packaging",
  status: "running",
};

const completedItem: SubagentWorkItem = {
  id: "child-report",
  title: "Compile architecture report",
  status: "completed",
};

afterEach(() => cleanup());

describe("SubagentActivityRow", () => {
  it("opens the real work item while keeping its status and latest progress visible", () => {
    const onOpen = vi.fn();

    render(<SubagentActivityRow item={runningItem} onOpen={onOpen} />);

    expect(screen.getByText("Explore plugin architecture")).toBeInTheDocument();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText("Reviewing tests and packaging")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Explore plugin architecture" }));
    expect(onOpen).toHaveBeenCalledWith(runningItem);
  });
});

describe("SubagentActivityDock", () => {
  it("stays absent when no subagent is running", () => {
    const { container } = render(<SubagentActivityDock items={[completedItem]} onOpen={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("opens above the composer and exposes only callbacks backed by runtime behavior", () => {
    const onOpen = vi.fn();
    const onStop = vi.fn();
    const onStopAll = vi.fn();

    render(
      <SubagentActivityDock
        items={[runningItem, completedItem]}
        onOpen={onOpen}
        onStop={onStop}
        onStopAll={onStopAll}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 Working" }));

    expect(screen.getByRole("dialog", { name: "Subagents" })).toBeInTheDocument();
    expect(screen.getByText("Reviewing tests and packaging")).toBeInTheDocument();
    expect(screen.queryByText("Compile architecture report")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop Explore plugin architecture" }));
    expect(onStop).toHaveBeenCalledWith("child-explore");

    fireEvent.click(screen.getByRole("button", { name: "Open Explore plugin architecture" }));
    expect(onOpen).toHaveBeenCalledWith(runningItem);

    fireEvent.click(screen.getByRole("button", { name: "Stop all subagents" }));
    expect(onStopAll).toHaveBeenCalledTimes(1);
  });

  it("keeps the activity popover inside the supplied Copilot surface", () => {
    const copilotSurface = document.createElement("section");
    copilotSurface.setAttribute("aria-label", "Copilot surface");
    document.body.appendChild(copilotSurface);

    render(
      <SubagentActivityDock
        items={[runningItem]}
        onOpen={vi.fn()}
        portalContainer={copilotSurface}
      />,
      { container: copilotSurface },
    );

    fireEvent.click(within(copilotSurface).getByRole("button", { name: "1 Working" }));

    const activity = within(copilotSurface).getByRole("dialog", { name: "Subagents" });
    expect(activity).toHaveClass(
      "w-[min(32rem,var(--radix-popover-content-available-width))]",
    );

    copilotSurface.remove();
  });

  it("does not invent stop controls without stop callbacks", () => {
    render(<SubagentActivityDock items={[runningItem]} onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "1 Working" }));

    expect(screen.queryByRole("button", { name: "Stop all subagents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop Explore plugin architecture" })).not.toBeInTheDocument();
  });
});

describe("SubagentDetailPanel", () => {
  it("keeps one quarter of the Copilot surface visibly exposed behind the right-side sheet", () => {
    const copilotSurface = document.createElement("section");
    copilotSurface.setAttribute("aria-label", "Copilot surface");
    document.body.appendChild(copilotSurface);

    render(
      <>
        <div>Parent agent conversation</div>
        <SubagentDetailPanel
          open
          item={runningItem}
          onClose={vi.fn()}
          portalContainer={copilotSurface}
        >
          <div>Child agent transcript</div>
        </SubagentDetailPanel>
      </>,
      { container: copilotSurface },
    );

    expect(within(copilotSurface).getByText("Parent agent conversation")).toBeInTheDocument();
    const sheet = within(copilotSurface).getByRole("dialog", {
      name: "Explore plugin architecture",
    });
    const scrim = [...copilotSurface.querySelectorAll<HTMLElement>("div")]
      .find((element) => element.classList.contains("z-[70]"));
    expect(scrim).toBeDefined();
    expect(scrim).toHaveClass("bg-black/30", "[backdrop-filter:blur(4px)]");
    expect(scrim).not.toHaveClass("bg-warm-page/65");
    expect(sheet).toHaveClass("right-0", "w-3/4", "max-w-sm");
    expect(sheet).not.toHaveClass("w-full", "w-[calc(100%-1rem)]");
    expect(within(sheet).getByText("Child agent transcript")).toBeInTheDocument();

    copilotSurface.remove();
  });

  it("reuses the supplied transcript renderer and only mounts a supplied composer", () => {
    const onClose = vi.fn();
    const onStop = vi.fn();

    render(
      <SubagentDetailPanel
        open
        item={runningItem}
        onClose={onClose}
        onStop={onStop}
        composer={<div>Real subagent composer</div>}
      >
        <div>Existing ACP transcript renderer</div>
      </SubagentDetailPanel>,
    );

    expect(screen.getByRole("dialog", { name: "Explore plugin architecture" })).toBeInTheDocument();
    expect(screen.getByText("Existing ACP transcript renderer")).toBeInTheDocument();
    expect(screen.getByText("Real subagent composer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop Explore plugin architecture" }));
    expect(onStop).toHaveBeenCalledWith("child-explore");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole("button", { name: "Back to conversation" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close subagent details" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("is read-only when no real follow-up composer is supplied", () => {
    render(
      <SubagentDetailPanel open item={completedItem} onClose={vi.fn()}>
        <div>Completed transcript</div>
      </SubagentDetailPanel>,
    );

    expect(screen.getByText("Completed transcript")).toBeInTheDocument();
    expect(screen.queryByText("Real subagent composer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop Compile architecture report" })).not.toBeInTheDocument();
  });
});
