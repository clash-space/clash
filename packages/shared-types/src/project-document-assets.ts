import { LoroMap, type LoroDoc } from "loro-crdt";

import { agentReadToken } from "./agent-read-proof.js";
import {
  DocumentAssetRevisionSchema,
  DocumentAttachmentSchema,
  ProjectDocumentAssetHeadSchema,
  ProjectDocumentAssetSchema,
  type DocumentAssetRevision,
  type DocumentAttachment,
  type ProjectDocumentAsset,
} from "./document-assets.js";
import { getDocumentKindDefinition } from "./document-kind-registry.js";
import { DocumentAssetRevisionRefSchema } from "./generator-v2.js";
import { readProjectAsset } from "./project-assets.js";
import {
  readGeneratorRevision,
  readProjectActionRun,
} from "./project-generators.js";

export const DOCUMENT_ASSET_SCHEMA_CONTAINER = "documentAssetSchema";
export const PROJECT_DOCUMENT_ASSETS_CONTAINER = "projectDocumentAssets";
export const DOCUMENT_ASSET_REVISIONS_CONTAINER = "documentAssetRevisions";
export const DOCUMENT_ATTACHMENTS_CONTAINER = "documentAttachments";
export const DOCUMENT_ASSET_AUTHORITY_VERSION = 1;

const AUTHORITY_VERSIONS_KEY = "authorityVersions";

export type DocumentAssetMutationErrorCode =
  | "UNSUPPORTED_DOCUMENT_ASSET_AUTHORITY"
  | "INVALID_DOCUMENT_ASSET"
  | "DOCUMENT_ASSET_EXISTS"
  | "DOCUMENT_ASSET_NOT_FOUND"
  | "DOCUMENT_KIND_NOT_DECLARED"
  | "DOCUMENT_REVISION_NOT_FOUND"
  | "DOCUMENT_REVISION_ID_COLLISION"
  | "DOCUMENT_FORK_FAMILY_MISMATCH"
  | "DOCUMENT_PRODUCER_NOT_FOUND"
  | "DOCUMENT_PRODUCER_OUTPUT_MISMATCH"
  | "DOCUMENT_SOURCE_NOT_FOUND"
  | "DOCUMENT_SOURCE_MEDIA_INACTIVE"
  | "STALE_DOCUMENT_HEAD"
  | "DOCUMENT_COPY_ON_WRITE_REQUIRED"
  | "INVALID_DOCUMENT_ATTACHMENT"
  | "DOCUMENT_ATTACHMENT_TARGET_NOT_FOUND"
  | "DOCUMENT_ATTACHMENT_TARGET_NOT_ALLOWED"
  | "DOCUMENT_ATTACHMENT_ID_COLLISION"
  | "DOCUMENT_ATTACHMENT_NOT_FOUND"
  | "STALE_DOCUMENT_ATTACHMENT";

export interface DocumentAssetMutationError {
  code: DocumentAssetMutationErrorCode;
  message: string;
  documentAssetId?: string;
  revisionId?: string;
  attachmentId?: string;
}

export type DocumentAssetMutationResult =
  | {
      ok: true;
      asset: ProjectDocumentAsset;
      revision: DocumentAssetRevision;
      changed: boolean;
    }
  | { ok: false; error: DocumentAssetMutationError };

export type DocumentAttachmentMutationResult =
  | { ok: true; attachment: DocumentAttachment; changed: boolean }
  | { ok: false; error: DocumentAssetMutationError };

function isLoroMap(value: unknown): value is LoroMap {
  return (
    value instanceof LoroMap ||
    Boolean(
      value &&
      typeof value === "object" &&
      typeof (value as { get?: unknown }).get === "function" &&
      typeof (value as { set?: unknown }).set === "function",
    )
  );
}

function sameFact(left: unknown, right: unknown): boolean {
  return (
    agentReadToken({ namespace: "document-asset-fact", subject: left }) ===
    agentReadToken({ namespace: "document-asset-fact", subject: right })
  );
}

function rawAuthorityVersion(doc: LoroDoc): unknown {
  const value = doc
    .getMap(DOCUMENT_ASSET_SCHEMA_CONTAINER)
    .get(AUTHORITY_VERSIONS_KEY);
  if (value === undefined) return undefined;
  if (!isLoroMap(value)) return value;
  const versions: number[] = [];
  for (const [key, marker] of value.entries()) {
    const version = Number(key);
    if (
      marker !== true ||
      !Number.isInteger(version) ||
      version < 1 ||
      String(version) !== key
    ) {
      return `invalid authority version fact ${key}`;
    }
    versions.push(version);
  }
  return versions.length === 0 ? undefined : Math.max(...versions);
}

function authorityError(doc: LoroDoc): DocumentAssetMutationError | undefined {
  const version = rawAuthorityVersion(doc);
  if (version === undefined || version === DOCUMENT_ASSET_AUTHORITY_VERSION) {
    return undefined;
  }
  return {
    code: "UNSUPPORTED_DOCUMENT_ASSET_AUTHORITY",
    message: `Unsupported Document Asset authority version: ${String(version)}`,
  };
}

export function markDocumentAssetAuthority(
  doc: LoroDoc,
):
  | { ok: true; version: typeof DOCUMENT_ASSET_AUTHORITY_VERSION }
  | { ok: false; error: DocumentAssetMutationError } {
  const unsupported = authorityError(doc);
  if (unsupported) return { ok: false, error: unsupported };
  doc
    .getMap(DOCUMENT_ASSET_SCHEMA_CONTAINER)
    .ensureMergeableMap(AUTHORITY_VERSIONS_KEY)
    .set(String(DOCUMENT_ASSET_AUTHORITY_VERSION), true);
  return { ok: true, version: DOCUMENT_ASSET_AUTHORITY_VERSION };
}

function revisionMap(doc: LoroDoc, documentAssetId: string): LoroMap | null {
  const value = doc
    .getMap(DOCUMENT_ASSET_REVISIONS_CONTAINER)
    .get(documentAssetId);
  return isLoroMap(value) ? value : null;
}

function documentKindError(
  revision: DocumentAssetRevision,
): DocumentAssetMutationError | undefined {
  const definition = getDocumentKindDefinition(
    revision.documentKind,
    revision.schemaVersion,
  );
  if (!definition) {
    return {
      code: "DOCUMENT_KIND_NOT_DECLARED",
      message: `Document kind ${revision.documentKind}@${revision.schemaVersion} is not declared.`,
      documentAssetId: revision.documentAssetId,
      revisionId: revision.id,
    };
  }
  if (definition.mutability !== revision.mutability) {
    return {
      code: "INVALID_DOCUMENT_ASSET",
      message: `Document kind ${revision.documentKind}@${revision.schemaVersion} requires ${definition.mutability} head semantics.`,
      documentAssetId: revision.documentAssetId,
      revisionId: revision.id,
    };
  }
  return undefined;
}

function revisionReferenceError(
  doc: LoroDoc,
  revision: DocumentAssetRevision,
): DocumentAssetMutationError | undefined {
  if (revision.forkedFrom) {
    const source = readDocumentAssetRevision(doc, revision.forkedFrom);
    if (!source) {
      return {
        code: "DOCUMENT_REVISION_NOT_FOUND",
        message: `Document fork source ${revision.forkedFrom.documentAssetId}/${revision.forkedFrom.revisionId} not found.`,
        documentAssetId: revision.documentAssetId,
        revisionId: revision.id,
      };
    }
    if (
      source.documentKind !== revision.documentKind ||
      source.schemaVersion !== revision.schemaVersion ||
      source.mutability !== revision.mutability
    ) {
      return {
        code: "DOCUMENT_FORK_FAMILY_MISMATCH",
        message: `Document fork source ${source.documentAssetId}/${source.id} has different kind, schema, or head mutability.`,
        documentAssetId: revision.documentAssetId,
        revisionId: revision.id,
      };
    }
  }

  if (revision.producer.kind === "action-run") {
    const run = readProjectActionRun(doc, revision.producer.actionRunId);
    if (!run) {
      return {
        code: "DOCUMENT_PRODUCER_NOT_FOUND",
        message: `Document producer Action Run ${revision.producer.actionRunId} not found.`,
        documentAssetId: revision.documentAssetId,
        revisionId: revision.id,
      };
    }
    const declaresDocument = run.outputContract.some(
      ({ assetType }) =>
        assetType.kind === "document" &&
        assetType.documentKind === revision.documentKind &&
        assetType.schemaVersion === revision.schemaVersion,
    );
    if (!declaresDocument) {
      return {
        code: "DOCUMENT_PRODUCER_OUTPUT_MISMATCH",
        message: `Action Run ${run.actionRunId} does not declare a ${revision.documentKind}@${revision.schemaVersion} Document output.`,
        documentAssetId: revision.documentAssetId,
        revisionId: revision.id,
      };
    }
  }

  for (const sourceRef of revision.sourceRefs) {
    const target = sourceRef.target;
    if ("kind" in target && target.kind === "media") {
      const source = readProjectAsset(doc, target.projectAssetId);
      if (!source) {
        return {
          code: "DOCUMENT_SOURCE_NOT_FOUND",
          message: `Document source ${sourceRef.slot} Project Asset ${target.projectAssetId} not found.`,
          documentAssetId: revision.documentAssetId,
          revisionId: revision.id,
        };
      }
      if (source.lifecycle.state !== "active") {
        return {
          code: "DOCUMENT_SOURCE_MEDIA_INACTIVE",
          message: `Document source ${sourceRef.slot} Project Asset ${target.projectAssetId} is ${source.lifecycle.state}.`,
          documentAssetId: revision.documentAssetId,
          revisionId: revision.id,
        };
      }
      continue;
    }
    if ("kind" in target && target.kind === "document") {
      if (readDocumentAssetRevision(doc, target)) continue;
      return {
        code: "DOCUMENT_SOURCE_NOT_FOUND",
        message: `Document source ${sourceRef.slot} revision ${target.documentAssetId}/${target.revisionId} not found.`,
        documentAssetId: revision.documentAssetId,
        revisionId: revision.id,
      };
    }
    if (readGeneratorRevision(doc, target)) continue;
    return {
      code: "DOCUMENT_SOURCE_NOT_FOUND",
      message: `Document source ${sourceRef.slot} Generator revision ${target.generatorId}/${target.generatorRevisionId} not found.`,
      documentAssetId: revision.documentAssetId,
      revisionId: revision.id,
    };
  }
  return undefined;
}

export function readDocumentAssetRevision(
  doc: LoroDoc,
  input: { documentAssetId: string; revisionId: string },
): DocumentAssetRevision | null {
  const revisions = revisionMap(doc, input.documentAssetId);
  if (!revisions) return null;
  const parsed = DocumentAssetRevisionSchema.safeParse(
    revisions.get(input.revisionId),
  );
  if (
    !parsed.success ||
    parsed.data.documentAssetId !== input.documentAssetId ||
    parsed.data.id !== input.revisionId
  ) {
    return null;
  }
  return parsed.data;
}

export function readProjectDocumentAsset(
  doc: LoroDoc,
  documentAssetIdInput: string,
): ProjectDocumentAsset | null {
  const documentAssetId = documentAssetIdInput.trim();
  const fields = doc
    .getMap(PROJECT_DOCUMENT_ASSETS_CONTAINER)
    .get(documentAssetId);
  if (!documentAssetId || !isLoroMap(fields)) return null;
  const head = ProjectDocumentAssetHeadSchema.safeParse({
    id: documentAssetId,
    headRevisionId: fields.get("headRevisionId"),
  });
  if (!head.success) return null;
  const revision = readDocumentAssetRevision(doc, {
    documentAssetId,
    revisionId: head.data.headRevisionId,
  });
  if (!revision) return null;
  return ProjectDocumentAssetSchema.parse({
    ...head.data,
    documentKind: revision.documentKind,
    mutability: revision.mutability,
  });
}

export function listProjectDocumentAssets(
  doc: LoroDoc,
): ProjectDocumentAsset[] {
  const assets: ProjectDocumentAsset[] = [];
  for (const [documentAssetId] of doc
    .getMap(PROJECT_DOCUMENT_ASSETS_CONTAINER)
    .entries()) {
    const asset = readProjectDocumentAsset(doc, documentAssetId);
    if (asset) assets.push(asset);
  }
  return assets.sort((left, right) => left.id.localeCompare(right.id));
}

export function listDocumentAssetRevisions(
  doc: LoroDoc,
  documentAssetIdInput: string,
): DocumentAssetRevision[] {
  const documentAssetId = documentAssetIdInput.trim();
  const revisions = documentAssetId ? revisionMap(doc, documentAssetId) : null;
  if (!revisions) return [];
  const entries: DocumentAssetRevision[] = [];
  for (const [revisionId] of revisions.entries()) {
    const revision = readDocumentAssetRevision(doc, {
      documentAssetId,
      revisionId,
    });
    if (revision) entries.push(revision);
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

export function createProjectDocumentAsset(
  doc: LoroDoc,
  revisionInput: DocumentAssetRevision,
): DocumentAssetMutationResult {
  const unsupported = authorityError(doc);
  if (unsupported) return { ok: false, error: unsupported };
  const parsed = DocumentAssetRevisionSchema.safeParse(revisionInput);
  if (!parsed.success || parsed.data.parentRevisionId !== undefined) {
    return {
      ok: false,
      error: {
        code: "INVALID_DOCUMENT_ASSET",
        message: parsed.success
          ? "An initial Document revision cannot have a parent."
          : (parsed.error.issues[0]?.message ?? "Invalid Document revision."),
      },
    };
  }
  const revision = parsed.data;
  const declarationError = documentKindError(revision);
  if (declarationError) return { ok: false, error: declarationError };
  const existing = readProjectDocumentAsset(doc, revision.documentAssetId);
  if (existing) {
    const existingRevision = readDocumentAssetRevision(doc, {
      documentAssetId: revision.documentAssetId,
      revisionId: revision.id,
    });
    if (
      existing.headRevisionId === revision.id &&
      existingRevision &&
      sameFact(existingRevision, revision)
    ) {
      return {
        ok: true,
        asset: existing,
        revision: existingRevision,
        changed: false,
      };
    }
    return {
      ok: false,
      error: {
        code: existingRevision
          ? "DOCUMENT_REVISION_ID_COLLISION"
          : "DOCUMENT_ASSET_EXISTS",
        message: `Document Asset ${revision.documentAssetId} already exists with different immutable facts.`,
        documentAssetId: revision.documentAssetId,
        revisionId: revision.id,
      },
    };
  }
  const rawRevision = revisionMap(doc, revision.documentAssetId)?.get(
    revision.id,
  );
  if (rawRevision !== undefined && !sameFact(rawRevision, revision)) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_REVISION_ID_COLLISION",
        message: `Document revision ${revision.id} already identifies different immutable facts.`,
        documentAssetId: revision.documentAssetId,
        revisionId: revision.id,
      },
    };
  }
  const referenceError = revisionReferenceError(doc, revision);
  if (referenceError) return { ok: false, error: referenceError };
  const revisions = doc
    .getMap(DOCUMENT_ASSET_REVISIONS_CONTAINER)
    .ensureMergeableMap(revision.documentAssetId);
  revisions.set(revision.id, revision);
  doc
    .getMap(PROJECT_DOCUMENT_ASSETS_CONTAINER)
    .ensureMergeableMap(revision.documentAssetId)
    .set("headRevisionId", revision.id);
  return {
    ok: true,
    asset: ProjectDocumentAssetSchema.parse({
      id: revision.documentAssetId,
      headRevisionId: revision.id,
      documentKind: revision.documentKind,
      mutability: revision.mutability,
    }),
    revision,
    changed: true,
  };
}

export function advanceProjectDocumentAssetHead(
  doc: LoroDoc,
  input: {
    documentAssetId: string;
    expectedHeadRevisionId: string;
    revision: DocumentAssetRevision;
  },
): DocumentAssetMutationResult {
  const unsupported = authorityError(doc);
  if (unsupported) return { ok: false, error: unsupported };
  const current = readProjectDocumentAsset(doc, input.documentAssetId);
  if (!current) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_ASSET_NOT_FOUND",
        message: `Document Asset ${input.documentAssetId} not found.`,
        documentAssetId: input.documentAssetId,
      },
    };
  }
  const parsed = DocumentAssetRevisionSchema.safeParse(input.revision);
  if (
    !parsed.success ||
    parsed.data.documentAssetId !== input.documentAssetId ||
    parsed.data.documentKind !== current.documentKind ||
    parsed.data.mutability !== current.mutability
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_DOCUMENT_ASSET",
        message: "The next Document revision changes its stable Asset facts.",
        documentAssetId: input.documentAssetId,
      },
    };
  }
  const revision = parsed.data;
  const declarationError = documentKindError(revision);
  if (declarationError) return { ok: false, error: declarationError };
  const existingRevision = readDocumentAssetRevision(doc, {
    documentAssetId: input.documentAssetId,
    revisionId: revision.id,
  });
  if (
    current.headRevisionId === revision.id &&
    existingRevision &&
    sameFact(existingRevision, revision)
  ) {
    return {
      ok: true,
      asset: current,
      revision: existingRevision,
      changed: false,
    };
  }
  if (current.headRevisionId !== input.expectedHeadRevisionId) {
    return {
      ok: false,
      error: {
        code: "STALE_DOCUMENT_HEAD",
        message: `Document Asset ${input.documentAssetId} changed after it was read.`,
        documentAssetId: input.documentAssetId,
      },
    };
  }
  if (current.mutability === "immutable") {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_COPY_ON_WRITE_REQUIRED",
        message: `Document Asset ${input.documentAssetId} is immutable; create a new Asset instead.`,
        documentAssetId: input.documentAssetId,
      },
    };
  }
  if (revision.parentRevisionId !== current.headRevisionId) {
    return {
      ok: false,
      error: {
        code: "INVALID_DOCUMENT_ASSET",
        message:
          "The next Document revision must name the observed head as its parent.",
        documentAssetId: input.documentAssetId,
        revisionId: revision.id,
      },
    };
  }
  const rawRevision = revisionMap(doc, input.documentAssetId)?.get(revision.id);
  if (rawRevision !== undefined && !sameFact(rawRevision, revision)) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_REVISION_ID_COLLISION",
        message: `Document revision ${revision.id} already identifies different immutable facts.`,
        documentAssetId: input.documentAssetId,
        revisionId: revision.id,
      },
    };
  }
  const referenceError = revisionReferenceError(doc, revision);
  if (referenceError) return { ok: false, error: referenceError };
  doc
    .getMap(DOCUMENT_ASSET_REVISIONS_CONTAINER)
    .ensureMergeableMap(input.documentAssetId)
    .set(revision.id, revision);
  const fields = doc
    .getMap(PROJECT_DOCUMENT_ASSETS_CONTAINER)
    .get(input.documentAssetId);
  if (!isLoroMap(fields)) {
    throw new Error(
      "Document Asset head disappeared during a Host-owned mutation.",
    );
  }
  fields.set("headRevisionId", revision.id);
  return {
    ok: true,
    asset: ProjectDocumentAssetSchema.parse({
      id: input.documentAssetId,
      headRevisionId: revision.id,
      documentKind: revision.documentKind,
      mutability: revision.mutability,
    }),
    revision,
    changed: true,
  };
}

export function readDocumentAttachment(
  doc: LoroDoc,
  attachmentIdInput: string,
): DocumentAttachment | null {
  const attachmentId = attachmentIdInput.trim();
  const fields = doc.getMap(DOCUMENT_ATTACHMENTS_CONTAINER).get(attachmentId);
  if (!attachmentId || !isLoroMap(fields)) return null;
  const parsed = DocumentAttachmentSchema.safeParse({
    id: attachmentId,
    target: fields.get("target"),
    slot: fields.get("slot"),
    document: fields.get("document"),
  });
  return parsed.success ? parsed.data : null;
}

export function listDocumentAttachments(doc: LoroDoc): DocumentAttachment[] {
  const attachments: DocumentAttachment[] = [];
  for (const [attachmentId] of doc
    .getMap(DOCUMENT_ATTACHMENTS_CONTAINER)
    .entries()) {
    const attachment = readDocumentAttachment(doc, attachmentId);
    if (attachment) attachments.push(attachment);
  }
  return attachments.sort((left, right) => left.id.localeCompare(right.id));
}

function readDocumentRef(
  doc: LoroDoc,
  value: unknown,
): DocumentAssetRevision | null {
  const ref = DocumentAssetRevisionRefSchema.safeParse(value);
  if (!ref.success) return null;
  return readDocumentAssetRevision(doc, {
    documentAssetId: ref.data.documentAssetId,
    revisionId: ref.data.revisionId,
  });
}

function attachmentTargetExists(
  doc: LoroDoc,
  target: DocumentAttachment["target"],
): boolean {
  switch (target.kind) {
    case "project-asset": {
      const asset = readProjectAsset(doc, target.projectAssetId);
      return Boolean(asset && asset.lifecycle.state !== "purged");
    }
    case "generator-revision":
      return Boolean(
        readGeneratorRevision(doc, {
          generatorId: target.generatorId,
          generatorRevisionId: target.generatorRevisionId,
        }),
      );
    case "action-run":
      return Boolean(readProjectActionRun(doc, target.actionRunId));
  }
}

export function ensureDocumentAttachment(
  doc: LoroDoc,
  input: DocumentAttachment,
): DocumentAttachmentMutationResult {
  const unsupported = authorityError(doc);
  if (unsupported) return { ok: false, error: unsupported };
  const parsed = DocumentAttachmentSchema.safeParse(input);
  const documentRevision = parsed.success
    ? readDocumentRef(doc, parsed.data.document)
    : null;
  if (!parsed.success || !documentRevision) {
    return {
      ok: false,
      error: {
        code: "INVALID_DOCUMENT_ATTACHMENT",
        message: parsed.success
          ? "A Document attachment must point to an existing immutable revision."
          : (parsed.error.issues[0]?.message ?? "Invalid Document attachment."),
      },
    };
  }
  const attachment = parsed.data;
  const declaration = getDocumentKindDefinition(
    documentRevision.documentKind,
    documentRevision.schemaVersion,
  );
  if (!declaration) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_KIND_NOT_DECLARED",
        message: `Document kind ${documentRevision.documentKind}@${documentRevision.schemaVersion} is not declared.`,
        attachmentId: attachment.id,
      },
    };
  }
  if (!attachmentTargetExists(doc, attachment.target)) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_ATTACHMENT_TARGET_NOT_FOUND",
        message: `Document attachment ${attachment.id} points to a missing target.`,
        attachmentId: attachment.id,
      },
    };
  }
  if (!declaration.allowedAttachmentTargets.includes(attachment.target.kind)) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_ATTACHMENT_TARGET_NOT_ALLOWED",
        message: `Document kind ${documentRevision.documentKind}@${documentRevision.schemaVersion} cannot attach to ${attachment.target.kind}.`,
        attachmentId: attachment.id,
      },
    };
  }
  const existing = readDocumentAttachment(doc, attachment.id);
  if (existing) {
    if (sameFact(existing, attachment)) {
      return { ok: true, attachment: existing, changed: false };
    }
    return {
      ok: false,
      error: {
        code: "DOCUMENT_ATTACHMENT_ID_COLLISION",
        message: `Document attachment ${attachment.id} already identifies different facts.`,
        attachmentId: attachment.id,
      },
    };
  }
  const fields = doc
    .getMap(DOCUMENT_ATTACHMENTS_CONTAINER)
    .ensureMergeableMap(attachment.id);
  fields.set("target", attachment.target);
  fields.set("slot", attachment.slot);
  fields.set("document", attachment.document);
  return { ok: true, attachment, changed: true };
}

export function advanceDocumentAttachment(
  doc: LoroDoc,
  input: {
    attachmentId: string;
    expectedRevisionId: string;
    document: unknown;
  },
): DocumentAttachmentMutationResult {
  const unsupported = authorityError(doc);
  if (unsupported) return { ok: false, error: unsupported };
  const current = readDocumentAttachment(doc, input.attachmentId);
  if (!current) {
    return {
      ok: false,
      error: {
        code: "DOCUMENT_ATTACHMENT_NOT_FOUND",
        message: `Document attachment ${input.attachmentId} not found.`,
        attachmentId: input.attachmentId,
      },
    };
  }
  const next = DocumentAssetRevisionRefSchema.safeParse(input.document);
  if (
    !next.success ||
    next.data.documentAssetId !== current.document.documentAssetId ||
    !readDocumentRef(doc, next.success ? next.data : undefined)
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_DOCUMENT_ATTACHMENT",
        message:
          "An attachment may advance only to an existing revision of the same Document Asset.",
        attachmentId: input.attachmentId,
      },
    };
  }
  if (current.document.revisionId === next.data.revisionId) {
    return { ok: true, attachment: current, changed: false };
  }
  if (current.document.revisionId !== input.expectedRevisionId) {
    return {
      ok: false,
      error: {
        code: "STALE_DOCUMENT_ATTACHMENT",
        message: `Document attachment ${input.attachmentId} changed after it was read.`,
        attachmentId: input.attachmentId,
      },
    };
  }
  const fields = doc
    .getMap(DOCUMENT_ATTACHMENTS_CONTAINER)
    .get(input.attachmentId);
  if (!isLoroMap(fields)) {
    throw new Error(
      "Document attachment disappeared during a Host-owned mutation.",
    );
  }
  fields.set("document", next.data);
  return {
    ok: true,
    attachment: { ...current, document: next.data },
    changed: true,
  };
}
