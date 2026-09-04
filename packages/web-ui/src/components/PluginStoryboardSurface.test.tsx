// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginStoryboardSurface } from "./PluginStoryboardSurface";

describe("PluginStoryboardSurface", () => {
  it("renders the four trace-backed groups and edits a material prompt", () => {
    const onSave = vi.fn();
    render(
      <PluginStoryboardSurface
        projectId="project-1"
        nodeId="storyboard-1"
        label="Storyboard"
        state={{
          keyElements: [{
            id: "Element_Protagonist_Player",
            description: [{ type: "text", text: "Player" }],
            materials: [{
              id: "Element_Protagonist_Player_img",
              mediaKind: "image",
              candidates: [],
            }],
          }],
          shots: [],
          audioLayers: [],
          uncategorized: [],
        }}
        assets={[]}
        generators={[]}
        onSave={onSave}
        onGenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Key elements")).toBeInTheDocument();
    expect(screen.getByText("Shots")).toBeInTheDocument();
    expect(screen.getByText("Audio layers")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Prompt for Element_Protagonist_Player_img"), {
      target: { value: "cinematic close-up" },
    });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      keyElements: [expect.objectContaining({
        materials: [expect.objectContaining({
          promptDraft: expect.objectContaining({ text: "cinematic close-up" }),
        })],
      })],
    }));
  });
});
