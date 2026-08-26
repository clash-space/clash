import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";

import { subscribeProjectAssetProjection } from "./liveProjectAssets";

describe("subscribeProjectAssetProjection", () => {
  it("projects the current Loro membership immediately on subscription", async () => {
    const doc = new LoroDoc();
    doc.getMap("projectAssets").set("asset:existing", {
      id: "asset:existing",
      kind: "image",
      lifecycle: { state: "active" },
    });
    doc.commit();
    const asset = {
      id: "asset:existing",
      kind: "image" as const,
      name: "existing.png",
      status: "ready" as const,
      url: "/api/v1/projects/project-1/assets/asset%3Aexisting/content",
      metadata: {},
      lifecycle: { state: "active" as const },
      provenance: { kind: "import" as const },
    };
    const readProjection = vi.fn().mockResolvedValue([asset]);
    const onProjection = vi.fn();

    const stop = subscribeProjectAssetProjection({
      doc,
      projectId: "project-1",
      readProjection,
      onProjection,
    });

    await vi.waitFor(() => expect(onProjection).toHaveBeenCalledWith([asset]));
    expect(readProjection).toHaveBeenCalledOnce();
    stop();
  });

  it("refreshes the resolved Project Asset projection when Loro membership changes", async () => {
    const doc = new LoroDoc();
    const asset = {
      id: "asset:dog",
      kind: "image" as const,
      name: "dog.png",
      status: "ready" as const,
      url: "/api/v1/projects/project-1/assets/asset%3Adog/content",
      metadata: { width: 1, height: 1 },
      lifecycle: { state: "active" as const },
      provenance: { kind: "import" as const },
    };
    const readProjection = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([asset]);
    const onProjection = vi.fn();
    const stop = subscribeProjectAssetProjection({
      doc,
      projectId: "project-1",
      readProjection,
      onProjection,
    });

    doc.getMap("nodes").set("node-1", { type: "image" });
    doc.commit();
    await Promise.resolve();
    expect(readProjection).toHaveBeenCalledOnce();

    doc.getMap("projectAssets").set("asset:dog", {
      id: "asset:dog",
      kind: "image",
      resourceId: "resource:dog",
      metadata: { width: 1, height: 1 },
      lifecycle: { state: "active" },
    });
    doc.commit();

    await vi.waitFor(() => {
      expect(onProjection).toHaveBeenCalledWith([asset]);
    });
    expect(readProjection).toHaveBeenCalledTimes(2);

    stop();
  });

  it("does not let an older HTTP projection overwrite a newer Loro revision", async () => {
    const doc = new LoroDoc();
    const resolutions: Array<(assets: []) => void> = [];
    const readProjection = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolutions.push(resolve);
        }),
    );
    const onProjection = vi.fn();
    const stop = subscribeProjectAssetProjection({
      doc,
      projectId: "project-1",
      readProjection,
      onProjection,
    });

    doc.getMap("projectAssets").set("asset:one", { id: "asset:one" });
    doc.commit();
    doc.getMap("projectAssets").set("asset:two", { id: "asset:two" });
    doc.commit();
    expect(resolutions).toHaveLength(3);

    resolutions[2]([]);
    await Promise.resolve();
    resolutions[1]([]);
    await Promise.resolve();
    resolutions[0]([]);
    await Promise.resolve();

    expect(onProjection).toHaveBeenCalledOnce();
    stop();
  });

  it("retries the same Loro revision after a transient Host projection failure", async () => {
    vi.useFakeTimers();
    try {
      const doc = new LoroDoc();
      const asset = {
        id: "asset:reconnected",
        kind: "image" as const,
        name: "reconnected.png",
        status: "ready" as const,
        url: "/api/v1/projects/project-1/assets/asset%3Areconnected/content",
        metadata: {},
        lifecycle: { state: "active" as const },
        provenance: { kind: "import" as const },
      };
      const readProjection = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce([asset]);
      const onProjection = vi.fn();
      const onError = vi.fn();
      doc.getMap("projectAssets").set("asset:reconnected", {
        id: "asset:reconnected",
      });
      doc.commit();
      const stop = subscribeProjectAssetProjection({
        doc,
        projectId: "project-1",
        readProjection,
        onProjection,
        onError,
        retryDelayMs: 25,
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(onError).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(25);
      expect(readProjection).toHaveBeenCalledTimes(2);
      expect(onProjection).toHaveBeenCalledWith([asset]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
