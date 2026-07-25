// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserMessage } from "./UserMessage";

vi.mock("./AgentAnnotationBlock", () => ({
  AgentAnnotationTray: ({
    annotations,
  }: {
    annotations: Array<{ id: string }>;
  }) => (
    <div data-testid="submitted-annotation-gui">
      {annotations.length} annotation
    </div>
  ),
}));

describe("UserMessage", () => {
  it("renders only the submitted annotation GUI when a message has annotations", () => {
    render(
      <UserMessage
        content={[
          '<!-- clash-workspace-context {"version":1,"projectId":"project-1"} -->',
          '<!-- clash-agent-annotations {"version":1,"kind":"clash-agent-annotations","annotations":[{"id":"annotation-1","kind":"agent-annotation","note":"Move this earlier.","target":{"projectId":"project-1","surface":"canvas","surfaceId":"main","surfaceLabel":"Main","objectId":"node-1","objectType":"canvas-image","objectLabel":"Hero still","objectPath":"canvases/main/nodes/node-1","capabilities":["read","modify"]}}]} -->',
          "Make this feel more cinematic.",
        ].join("\n")}
      />,
    );

    expect(screen.queryByText("Make this feel more cinematic.")).toBeNull();
    expect(screen.getByTestId("submitted-annotation-gui").textContent).toBe(
      "1 annotation",
    );
    expect(screen.queryByText(/clash-agent-annotations/)).toBeNull();
    expect(screen.queryByText(/clash-workspace-context/)).toBeNull();
  });
});
