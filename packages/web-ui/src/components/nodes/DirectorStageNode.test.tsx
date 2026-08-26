// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import {
  createProjectDirectorStage,
  type ResolvedAsset,
} from "@clash/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DirectorStageProvider } from "../DirectorStageContext";
import { ProjectProvider } from "../ProjectContext";
import DirectorStageNode from "./DirectorStageNode";

const mocks = vi.hoisted(() => ({
  doc: null as LoroDoc | null,
  resolvedLegacyVideo: {
    id: "asset-video",
    kind: "video",
    metadata: {},
    lifecycle: { state: "active" },
    status: "ready",
    url: "https://host.example/assets/asset-video",
  } satisfies ResolvedAsset,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Right: "right" },
}));

vi.mock("../LoroSyncContext", () => ({
  useOptionalLoroSyncContext: () => (mocks.doc ? { doc: mocks.doc } : null),
}));

vi.mock("../../lib/hooks/useAsset", () => ({
  useAsset: () => mocks.resolvedLegacyVideo,
}));

const baseProps = {
  id: "director-stage-node",
  selected: false,
  type: "director-stage",
  dragging: false,
  draggable: true,
  selectable: true,
  deletable: true,
  zIndex: 1,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  data: {
    stageId: "stage-1",
    outputVideoAssetId: "asset-video",
    directorReferencePacket: {
      schemaVersion: 1,
      stageId: "stage-1",
      stageRevisionId: "stage-revision-1",
      exportedAt: "2026-08-15T00:00:00.000Z",
      aspectRatio: "16:9",
      durationSeconds: 6,
      fps: 30,
      cameraIds: ["camera-1"],
      referenceVideo: {
        assetId: "asset-video",
        mimeType: "video/webm",
      },
      referenceStills: [],
      shotSpec: { shots: [] },
    },
  },
} as const;

function renderDirectorStage(onOpenDirectorStage = vi.fn()) {
  return {
    onOpenDirectorStage,
    ...render(
      <ProjectProvider projectId="project-1" initialModelCatalog={[]}>
        <DirectorStageProvider onOpenDirectorStage={onOpenDirectorStage}>
          <DirectorStageNode {...baseProps} />
        </DirectorStageProvider>
      </ProjectProvider>,
    ),
  };
}

describe("DirectorStageNode", () => {
  beforeEach(() => {
    mocks.doc = new LoroDoc();
    const created = createProjectDirectorStage(mocks.doc, {
      id: "stage-1",
      name: "Courtyard blocking",
      state: {
        schemaVersion: 1,
        scene: {
          backgroundColor: "#171816",
          grid: { visible: true, snap: false, size: 1 },
        },
        objects: [],
        cameras: [],
        shots: [],
      },
    });
    if (!created.ok) throw new Error(created.error);
  });

  afterEach(() => {
    cleanup();
    mocks.doc = null;
  });

  it("renders the stored Stage with its exported reference video preview", () => {
    const { container } = renderDirectorStage();

    expect(screen.getByText("Courtyard blocking")).toBeTruthy();
    expect(screen.getByText("0 objects")).toBeTruthy();
    expect(screen.getByText("0 cameras")).toBeTruthy();
    expect(screen.getByText("Reference video ready")).toBeTruthy();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://host.example/assets/asset-video",
    );
  });

  it("opens the independently stored Stage", () => {
    const { onOpenDirectorStage } = renderDirectorStage();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Director Stage" }),
    );
    expect(onOpenDirectorStage).toHaveBeenCalledWith("stage-1");
  });
});
