import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./ProjectEditor.tsx", import.meta.url),
  "utf8",
);

describe("ProjectEditor workspace model", () => {
  it("projects one Project Loro replica into a selected concrete Canvas", () => {
    expect(source).toMatch(/useState\(['"]main['"]\)/);
    expect(source).toMatch(/useLoroSync\(\{[\s\S]*canvasId: activeCanvasId/);
    expect(source).toContain("<ProjectWorkspaceNavigator");
    expect(source).toContain("<EditableProjectAssetSurface");
    expect(source).toContain("<ProjectTimelineEditorSurface");
    expect(source).toContain("<ProjectDirectorStageSurface");
    expect(source).not.toContain("<StandaloneTimelineSurface");
    expect(source).toContain('id="project-workspace-shell"');
    expect(source).toContain("grid-cols-[12rem_minmax(0,1fr)]");
    expect(source).toContain("header={");
    expect(source).toContain("footer={<UserControls compact />}");
    expect(source).not.toContain('id="project-top-actions"');
    expect(source).not.toContain("topActionsRight");
    expect(source).toContain("clash-project-sidebar-header");
    expect(source).not.toContain("className={`absolute bottom-0 left-52");
  });

  it("persists a fully collapsible project navigator with one workspace-owned toggle", () => {
    expect(source).toMatch(
      /localStorage\.getItem\(["']project-navigator-collapsed["']\)/,
    );
    expect(source).toMatch(
      /localStorage\.setItem\(\s*["']project-navigator-collapsed["']/,
    );
    expect(source).toMatch(
      /data-project-navigator-collapsed=\{\s*isProjectNavigatorCollapsed\s*\}/,
    );
    expect(source).toContain(
      "data-[project-navigator-collapsed=true]:grid-cols-[0_minmax(0,1fr)]",
    );
    expect(source).toMatch(/collapsed=\{\s*isProjectNavigatorCollapsed\s*\}/);
    expect(source).not.toContain(
      "onCollapsedChange={setIsProjectNavigatorCollapsed}",
    );
    expect(source).not.toContain("clash-project-sidebar-toggle-button");
    expect(source).toContain("PROJECT_NAVIGATOR_VISIBILITY_EVENT");
    expect(source).toContain(
      "setIsProjectNavigatorCollapsed(detail.collapsed)",
    );
    expect(source).toContain("data-project-workspace-toolbar");
  });

  it("does not reconstruct Canvas ownership from the Project asset list", () => {
    expect(source).not.toContain("buildFallbackCanvasFromAssets");
    expect(source).not.toContain("recoveredFromAssetRef");
  });

  it("creates Timeline Actions through Timeline ownership primitives", () => {
    expect(source).toMatch(
      /type === ["']video-editor["'][\s\S]*createTimeline\([\s\S]*attachTimeline\(/,
    );
  });

  it("creates Director Stage Actions through independent Stage ownership primitives", () => {
    expect(source).toMatch(
      /type === ["']director-stage["'][\s\S]*createDirectorStage\([\s\S]*attachDirectorStage\(/,
    );
    expect(source).toContain('onDoubleClick={createDirectorStageFromPane}');
    expect(source).toContain('classList.contains("react-flow__pane")');
    expect(source).toContain("directorStages={loroSync.directorStages}");
    expect(source).toContain("onOpenDirectorStage={openDirectorStageFromCanvasAction}");
    expect(source).toContain("onCaptureShot={captureDirectorStageShot}");
    expect(source).toContain("onUploadModel={uploadDirectorModel}");
    expect(source).toContain("DIRECTOR_BUILTIN_MODEL_ASSET_URLS");
    expect(source).toContain("!DIRECTOR_BUILTIN_MODEL_ASSET_URLS[object.model.assetId]");
    expect(source).toContain("onGeneratePanorama={generateDirectorPanorama}");
    expect(source).toContain("normalizeDirectorPanorama(file");
    expect(source).toContain('panoramaProjection: "equirectangular"');
    expect(source).toContain('aspect_ratio: "21:9"');
    expect(source).toContain('kind: "model"');
  });

  it("inspects uploaded Director models and persists discovered animation metadata", () => {
    expect(source).toContain("inspectDirectorModelFile");
    expect(source).toContain("animation: animationMetadata");
  });

  it("routes Director text-to-3D through the local runtime and stage callback", () => {
    expect(source).toContain("onGenerateModel={generateDirectorModel}");
    expect(source).toContain('runtimeApiUrl("/api/v1/director-model-generations")');
    expect(source).toContain("body: JSON.stringify({ projectId: project.id, ...input })");
  });

  it("sizes Director Stage shot nodes to the captured aspect ratio", () => {
    expect(source).toContain("calculateDimensionsFromAspectRatio");
    expect(source).toMatch(
      /const shotNodeSize = calculateDimensionsFromAspectRatio\(\s*input\.aspectRatio,?\s*\)/,
    );
    expect(source).toContain("width: shotNodeSize.width");
    expect(source).toContain("height: shotNodeSize.height");
    expect(source).toContain("aspectRatio: input.aspectRatio");
    expect(source).toContain("timeSeconds: input.timeSeconds");
  });

  it("publishes Director video exports back to the Stage node for downstream generation", () => {
    const exportCallback =
      source.match(/const exportDirectorStageVideo = useCallback\([\s\S]*?\n {2}\);/)?.[0] ?? "";

    expect(exportCallback).toContain("importProjectAssetFile");
    expect(exportCallback).toContain("outputVideoAssetId");
    expect(exportCallback).toContain("outputVideoSrc");
    expect(exportCallback).toContain("createDirectorReferencePacket");
    expect(exportCallback).toContain("directorReferencePacket");
    expect(exportCallback).toContain("directorShotReferencePackets");
    expect(exportCallback).toContain('input.mode === "selected-shots"');
    expect(exportCallback).toContain("sourceDirectorStageShotId");
    expect(exportCallback).toContain("autoRun: true");
    expect(exportCallback).toContain("render.referenceFrames");
    expect(exportCallback).toContain('op: "shot.register"');
    expect(exportCallback).toContain("loroSync.applyDirectorStageState");
    expect(exportCallback).toContain("loroSync.updateNode");
    expect(exportCallback).not.toContain("createTimeline");
    expect(exportCallback).not.toContain("attachTimeline");
    expect(exportCallback).not.toContain("requestTimelineRender");
    expect(exportCallback).not.toContain("applyTimelineState");
  });

  it("opens a Timeline as an editor document instead of an information surface", () => {
    expect(source).toContain("timelines={loroSync.timelines}");
    expect(source).toContain("applyTimelineState");
    expect(source).toContain("onOpenTimeline={openTimelineFromCanvasAction}");
    expect(source).toContain("onOpenCanvas={selectCanvasFromNavigator}");
    expect(source).not.toContain("onExit={exitTimelineEditor}");
    expect(source).not.toContain(
      "standaloneTimelines={loroSync.standaloneTimelines}",
    );
    expect(source).toContain("selectTimelineMediaInputs({");
    const timelineSurface =
      source.match(/<ProjectTimelineEditorSurface[\s\S]*?\/>/)?.[0] ?? "";
    expect(timelineSurface).toContain("mediaInputs={timelineMediaInputs}");
    expect(timelineSurface).toContain("key={selectedTimeline.id}");
    expect(timelineSurface).not.toContain("assets={projectAssets}");
    expect(timelineSurface).toContain("onRequestAsset={() =>");
  });

  it("attributes Timeline exports to the signed-in user with a local owner fallback", () => {
    expect(source).toContain("betterAuthClient.useSession()");
    expect(source).toContain("session.data?.user?.id || project.ownerId");
    expect(source).toContain("actorUserId: timelineExportActorUserId");
  });

  it("uses one scope-aware picker for Canvas and Timeline media acquisition", () => {
    expect(source).toContain("<ScopedAssetPicker");
    expect(source).toContain("buildScopedAssetSections({");
    expect(source).toContain(
      "planAssetScopeCascade({ source: option.source, target })",
    );
    expect(source).toContain(
      'setAssetPickerTarget({ kind: "canvas", canvasId: activeCanvasId })',
    );
  });

  it("keeps collapsed editors full-width and reserves a gutter for the expanded floating Copilot", () => {
    expect(source).toMatch(
      /const shouldReserveCopilotSpace\s*=\s*workspaceSurface\.kind !== "canvas" && !isSidebarCollapsed/,
    );
    expect(source).toMatch(
      /const copilotWorkspaceRight\s*=\s*shouldReserveCopilotSpace[\s\S]*?sidebarWidth \+ COPILOT_PANEL_GUTTER_PX \* 2[\s\S]*?: 0/,
    );
    expect(source).toContain(
      'collapsedLauncherPlacement={workspaceSurface.kind === "canvas" ? "canvas" : "header"}',
    );
    expect(source).toContain("headerEndInset={copilotHeaderInset}");
    expect(source).not.toContain("COPILOT_COLLAPSED_RAIL_WIDTH_PX");
    expect(source).toMatch(
      /data-copilot-layout=\{\s*shouldReserveCopilotSpace\s*\?\s*"reserved-floating"\s*:\s*"overlay"\s*\}/,
    );
    expect(source).toMatch(
      /id="project-workspace-shell"[\s\S]*?style=\{\{[\s\S]*?right: copilotWorkspaceRight/,
    );
    expect(source).not.toContain("rightInset={copilotWorkspaceInset}");
    expect(source).toContain('layoutMode="floating"');
    expect(source).not.toContain('layoutMode="docked"');
    expect(source.match(/<ChatbotCopilot/g)).toHaveLength(1);

    const copilotKey =
      source.match(/<ChatbotCopilot[\s\S]*?key=\{([^}]+)\}/)?.[1] ?? "";
    expect(copilotKey).not.toContain("workspaceSurface");
  });

  it("delegates the Home composer prompt to the Project composer without creating a cloud session", () => {
    expect(source).toContain("initialPrompt={chatInitialPrompt}");
    expect(source).not.toContain("handleCreateSession(initialPrompt)");
  });

  it("warms the Timeline editor bundle after project data becomes available", () => {
    expect(source).toContain("preloadTimelineEditor");
    expect(source).toContain("requestIdleCallback");
    expect(source).toContain("cancelIdleCallback");
  });

  it("selects one project asset at a time and accepts sidebar asset drops on Canvas", () => {
    expect(source).toContain("onSelectAsset={(assetId) =>");
    expect(source).toContain('workspaceSurface.kind === "asset"');
    expect(source).toMatch(
      /onDragEnterCapture=\{\s*handleCanvasAssetDragEnter\s*\}/,
    );
    expect(source).toMatch(
      /onDragOverCapture=\{\s*handleCanvasAssetDragOver\s*\}/,
    );
    expect(source).toMatch(
      /onDragLeaveCapture=\{\s*handleCanvasAssetDragLeave\s*\}/,
    );
    expect(source).toMatch(/onDropCapture=\{\s*handleCanvasAssetDrop\s*\}/);
    expect(source).toContain('data-testid="canvas-asset-drop-target"');
    expect(source).toContain("onDragEndCapture={clearCanvasAssetDropTarget}");
    expect(source).not.toContain("<ProjectAssetsSurface");
  });

  it("feeds asset Preview a project-wide relation graph and real workspace navigation", () => {
    expect(source).toContain("readAssetRelationGraph(");
    expect(source).toContain('loroSync.doc.getMap("nodes").entries()');
    expect(source).toContain('loroSync.doc.getMap("edges").entries()');
    expect(source).toContain("relationNodes={assetRelationGraph.nodes}");
    expect(source).toContain("relationEdges={assetRelationGraph.edges}");
    expect(source).toContain("onOpenCanvas={openAssetRelationCanvas}");
    expect(source).toContain("onOpenTimeline={openAssetRelationTimeline}");
    expect(source).toContain("onOpenAsset={openRelatedAsset}");
  });

  it("does not clear the live projection when returning to the already-active Canvas", () => {
    const selectCanvasStart = source.indexOf(
      "const selectCanvas = useCallback",
    );
    const selectCanvasEnd = source.indexOf(
      "const focusPendingAgentTarget",
      selectCanvasStart,
    );
    const selectCanvasSource = source.slice(selectCanvasStart, selectCanvasEnd);

    expect(selectCanvasStart).toBeGreaterThan(-1);
    expect(selectCanvasSource).toContain(
      "activeCanvasIdRef.current !== canvasId",
    );
    expect(selectCanvasSource).toMatch(
      /if \(activeCanvasIdRef\.current !== canvasId\) \{[\s\S]*setNodes\(\[\]\);[\s\S]*setEdges\(\[\]\);[\s\S]*\}/,
    );
  });
});
