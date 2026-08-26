import type { ResolvedAsset } from "@clash/shared-types";
import type { LoroDoc } from "loro-crdt";

import { listProjectAssets } from "./hooks/useAsset";

type ProjectAssetProjectionSubscription = {
  doc: LoroDoc;
  projectId: string;
  readProjection?: (projectId: string) => Promise<ResolvedAsset[]>;
  onProjection: (assets: ResolvedAsset[]) => void;
  onError?: (error: unknown) => void;
};

function projectAssetMembershipFingerprint(doc: LoroDoc): string {
  return JSON.stringify(doc.getMap("projectAssets").toJSON());
}

/**
 * Loro owns Project Asset membership and lifecycle. Resolved delivery URLs stay
 * Host projections, so a membership revision invalidates and re-reads that
 * projection instead of creating a second browser-side asset timeline.
 */
export function subscribeProjectAssetProjection({
  doc,
  projectId,
  readProjection = listProjectAssets,
  onProjection,
  onError,
}: ProjectAssetProjectionSubscription): () => void {
  let fingerprint = projectAssetMembershipFingerprint(doc);
  let latestRequest = 0;
  let disposed = false;

  const unsubscribe = doc.subscribe(() => {
    const nextFingerprint = projectAssetMembershipFingerprint(doc);
    if (nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;

    const request = ++latestRequest;
    void readProjection(projectId)
      .then((assets) => {
        if (disposed || request !== latestRequest) return;
        onProjection(assets);
      })
      .catch((error) => {
        if (disposed || request !== latestRequest) return;
        onError?.(error);
      });
  });

  return () => {
    disposed = true;
    latestRequest += 1;
    unsubscribe();
  };
}
