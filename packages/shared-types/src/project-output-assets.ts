import type { LoroDoc } from "loro-crdt";

import {
  AssetRevisionRefSchema,
  type AssetRevisionRef,
  type GeneratorAssetType,
} from "./generator-v2.js";
import { readDocumentAssetRevision } from "./project-document-assets.js";
import { readProjectAsset } from "./project-assets.js";

export type OutputCommitAssetTypeResolver = (
  doc: LoroDoc,
  asset: AssetRevisionRef,
) => GeneratorAssetType | null;

/**
 * Resolve the exact public Asset contract behind one storage-free output ref.
 * Generated media must still be active when it is first committed; Document
 * outputs always name one immutable revision rather than a mutable head.
 */
export const resolveOutputCommitAssetType: OutputCommitAssetTypeResolver = (
  doc,
  assetInput,
) => {
  const asset = AssetRevisionRefSchema.safeParse(assetInput);
  if (!asset.success) return null;
  if (asset.data.kind === "media") {
    const entry = readProjectAsset(doc, asset.data.projectAssetId);
    if (!entry || entry.lifecycle.state !== "active") return null;
    return { kind: "media", mediaKind: entry.kind };
  }
  const revision = readDocumentAssetRevision(doc, asset.data);
  return revision
    ? {
        kind: "document",
        documentKind: revision.documentKind,
        schemaVersion: revision.schemaVersion,
      }
    : null;
};
