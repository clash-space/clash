import { isDeepStrictEqual } from "node:util";

import type { LoroDoc } from "loro-crdt";

import {
  commitActionRunOutcome,
  createProjectDocumentAsset,
  ensureActionRunRequest,
  ensureOutputCommit,
  listActionAssetBindings,
  markActionRunStarted,
  readOutputCommit,
  readDocumentAssetRevision,
  readProjectAsset,
  readProjectActionRun,
  readProjectDocumentAsset,
  resolveOutputCommitAssetType,
  type ActionAssetBinding,
  type ActionRunRequest,
  type DocumentAssetRevision,
  type OutputCommit,
  type ProjectAssetEntry,
  type ProjectActionRun,
  type ProjectDocumentAsset,
  type ProjectGeneratorMutationError,
} from "@clash/shared-types";

import {
  createLocalDurableRun,
  type LocalDurableRunCreateCommand,
} from "./durable-run-coordinator.js";
import type { SqliteDurableRunJournal } from "./durable-run-journal.js";
import { publishLocalProjectAssetWithBindings } from "./local-project-assets.js";

export interface LocalGeneratorMediaPublication {
  entry: ProjectAssetEntry;
  legacyBinding: ActionAssetBinding;
  commit: OutputCommit;
  run: ProjectActionRun;
  changed: boolean;
}

export interface LocalGeneratorFailurePublication {
  run: ProjectActionRun;
  changed: boolean;
  winnerPreserved: boolean;
}

export interface LocalGeneratorDocumentPublication {
  asset: ProjectDocumentAsset;
  revision: DocumentAssetRevision;
  commit: OutputCommit;
  run: ProjectActionRun;
  changed: boolean;
}

export interface LocalGeneratorRunBridge {
  enqueue(input: {
    doc: LoroDoc;
    request: ActionRunRequest;
    command: LocalDurableRunCreateCommand;
    checkpoint: () => Promise<void>;
  }): Promise<ProjectActionRun>;
  projectRunning(input: {
    doc: LoroDoc;
    identity: { actionRunId: string; outputSlot: string };
    checkpoint: () => Promise<void>;
  }): Promise<ProjectActionRun>;
  publishMediaSuccess(input: {
    doc: LoroDoc;
    actionRunId: string;
    outputSlot: string;
    entry: ProjectAssetEntry;
    legacyBinding: ActionAssetBinding;
    checkpoint: () => Promise<void>;
  }): Promise<LocalGeneratorMediaPublication>;
  publishDocumentSuccess(input: {
    doc: LoroDoc;
    actionRunId: string;
    outputSlot: string;
    revision: DocumentAssetRevision;
    checkpoint: () => Promise<void>;
  }): Promise<LocalGeneratorDocumentPublication>;
  publishFailure(input: {
    doc: LoroDoc;
    actionRunId: string;
    checkpoint: () => Promise<void>;
  }): Promise<LocalGeneratorFailurePublication>;
}

function generatorMutationFailure(error: ProjectGeneratorMutationError): never {
  throw new Error(`${error.code}: ${error.message}`);
}

function applyMediaSuccess(
  doc: LoroDoc,
  input: {
    actionRunId: string;
    outputSlot: string;
    entry: ProjectAssetEntry;
    legacyBinding: ActionAssetBinding;
  },
): LocalGeneratorMediaPublication {
  const run = readProjectActionRun(doc, input.actionRunId);
  const port = run?.outputContract.find(
    (candidate) => candidate.slot === input.outputSlot,
  );
  if (
    !run ||
    !port ||
    port.assetType.kind !== "media" ||
    port.assetType.mediaKind !== input.entry.kind
  ) {
    throw new Error(
      "The published media Asset does not match the Generator Action Run output contract.",
    );
  }
  if (
    input.legacyBinding.owner.kind !== "run" ||
    input.legacyBinding.owner.actionRunId !== input.actionRunId ||
    input.legacyBinding.owner.actionId !== run.generatorRevision.generatorId ||
    input.legacyBinding.owner.actionRevisionId !==
      run.generatorRevision.generatorRevisionId ||
    input.legacyBinding.direction !== "output" ||
    input.legacyBinding.slot !== input.outputSlot ||
    input.legacyBinding.projectAssetId !== input.entry.id
  ) {
    throw new Error(
      "The legacy ActionAssetBinding must identify the same Generator revision, Run, output slot, and Asset.",
    );
  }

  const existingCommit = readOutputCommit(doc, {
    actionRunId: input.actionRunId,
    outputSlot: input.outputSlot,
  });
  if (existingCommit) {
    if (existingCommit.asset.kind !== "media") {
      throw new Error(
        "The existing Generator output winner is not a media Asset.",
      );
    }
    const existingProjectAssetId = existingCommit.asset.projectAssetId;
    const existingEntry = readProjectAsset(doc, existingProjectAssetId);
    const existingBinding = listActionAssetBindings(doc).find(
      (candidate) =>
        candidate.owner.kind === "run" &&
        candidate.owner.actionRunId === input.actionRunId &&
        candidate.direction === "output" &&
        candidate.slot === input.outputSlot &&
        candidate.projectAssetId === existingProjectAssetId,
    );
    if (!existingEntry || !existingBinding) {
      throw new Error(
        "The existing Generator output winner is missing its Project Asset or legacy binding.",
      );
    }
    const outcome = commitActionRunOutcome(doc, {
      actionRunId: input.actionRunId,
      status: "succeeded",
    });
    if (!outcome.ok) generatorMutationFailure(outcome.error);
    return {
      entry: existingEntry,
      legacyBinding: existingBinding,
      commit: existingCommit,
      run: outcome.run,
      changed: outcome.changed,
    };
  }

  const publication = publishLocalProjectAssetWithBindings(doc, input.entry, [
    input.legacyBinding,
  ]);
  const output = ensureOutputCommit(
    doc,
    {
      actionRunId: input.actionRunId,
      outputSlot: input.outputSlot,
      asset: { kind: "media", projectAssetId: input.entry.id },
    },
    resolveOutputCommitAssetType,
  );
  if (!output.ok) generatorMutationFailure(output.error);
  const outcome = commitActionRunOutcome(doc, {
    actionRunId: input.actionRunId,
    status: "succeeded",
  });
  if (!outcome.ok) generatorMutationFailure(outcome.error);
  return {
    entry: publication.entry,
    legacyBinding: publication.bindings[0]!,
    commit: output.commit,
    run: outcome.run,
    changed: publication.changed || output.changed || outcome.changed,
  };
}

function applyFailure(
  doc: LoroDoc,
  actionRunId: string,
): LocalGeneratorFailurePublication {
  const run = readProjectActionRun(doc, actionRunId);
  if (!run) {
    throw new Error(
      `ACTION_RUN_NOT_FOUND: Action Run ${actionRunId} not found.`,
    );
  }
  const hasWinner = run.outputContract.some(
    (output) =>
      readOutputCommit(doc, {
        actionRunId,
        outputSlot: output.slot,
      }) !== null,
  );
  const status =
    hasWinner || run.status === "succeeded" ? "succeeded" : "failed";
  const outcome = commitActionRunOutcome(doc, { actionRunId, status });
  if (!outcome.ok) generatorMutationFailure(outcome.error);
  return {
    run: outcome.run,
    changed: outcome.changed,
    winnerPreserved: status === "succeeded",
  };
}

function applyDocumentSuccess(
  doc: LoroDoc,
  input: {
    actionRunId: string;
    outputSlot: string;
    revision: DocumentAssetRevision;
  },
): LocalGeneratorDocumentPublication {
  const run = readProjectActionRun(doc, input.actionRunId);
  const port = run?.outputContract.find(
    (candidate) => candidate.slot === input.outputSlot,
  );
  if (
    !run ||
    !port ||
    port.assetType.kind !== "document" ||
    port.assetType.documentKind !== input.revision.documentKind ||
    port.assetType.schemaVersion !== input.revision.schemaVersion ||
    input.revision.producer.kind !== "action-run" ||
    input.revision.producer.actionRunId !== input.actionRunId
  ) {
    throw new Error(
      "The published Document revision does not match the Generator Action Run output contract and producer.",
    );
  }

  const existingCommit = readOutputCommit(doc, {
    actionRunId: input.actionRunId,
    outputSlot: input.outputSlot,
  });
  if (existingCommit) {
    if (existingCommit.asset.kind !== "document") {
      throw new Error(
        "The existing Generator output winner is not a Document Asset.",
      );
    }
    const asset = readProjectDocumentAsset(
      doc,
      existingCommit.asset.documentAssetId,
    );
    const revision = readDocumentAssetRevision(doc, existingCommit.asset);
    if (!asset || !revision) {
      throw new Error(
        "The existing Generator Document output winner is missing its immutable revision.",
      );
    }
    const outcome = commitActionRunOutcome(doc, {
      actionRunId: input.actionRunId,
      status: "succeeded",
    });
    if (!outcome.ok) generatorMutationFailure(outcome.error);
    return {
      asset,
      revision,
      commit: existingCommit,
      run: outcome.run,
      changed: outcome.changed,
    };
  }

  const document = createProjectDocumentAsset(doc, input.revision);
  if (!document.ok) {
    throw new Error(`${document.error.code}: ${document.error.message}`);
  }
  const output = ensureOutputCommit(
    doc,
    {
      actionRunId: input.actionRunId,
      outputSlot: input.outputSlot,
      asset: {
        kind: "document",
        documentAssetId: input.revision.documentAssetId,
        revisionId: input.revision.id,
      },
    },
    resolveOutputCommitAssetType,
  );
  if (!output.ok) generatorMutationFailure(output.error);
  const outcome = commitActionRunOutcome(doc, {
    actionRunId: input.actionRunId,
    status: "succeeded",
  });
  if (!outcome.ok) generatorMutationFailure(outcome.error);
  return {
    asset: document.asset,
    revision: document.revision,
    commit: output.commit,
    run: outcome.run,
    changed: document.changed || output.changed || outcome.changed,
  };
}

export function createLocalGeneratorRunBridge(options: {
  ownerId: string;
  journal: SqliteDurableRunJournal;
}): LocalGeneratorRunBridge {
  return {
    async enqueue(input) {
      if (
        input.command.actionRunId !== input.request.actionRunId ||
        !input.request.outputContract.some(
          (output) => output.slot === input.command.outputSlot,
        )
      ) {
        throw new Error(
          "A Generator Action Run request and its private durable task must have the same Run and output identity.",
        );
      }
      if (
        input.command.executor.targetKind !== "generator-action" ||
        input.command.executor.actionId !== input.request.actionId ||
        !isDeepStrictEqual(
          input.command.executor.generatorOutputContract,
          input.request.outputContract,
        )
      ) {
        throw new Error(
          "A Generator v2 Run requires a generator-action task frozen from its exact Action id and output contract.",
        );
      }
      if (
        !isDeepStrictEqual(
          input.command.executor.binding,
          input.request.executor,
        )
      ) {
        throw new Error(
          "A Generator v2 Run requires a private task frozen from its exact public executor.",
        );
      }
      if (
        input.command.executor.publicOwner?.actionId !==
          input.request.generatorRevision.generatorId ||
        input.command.executor.publicOwner.actionRevisionId !==
          input.request.generatorRevision.generatorRevisionId
      ) {
        throw new Error(
          "A Generator v2 task public owner must identify the exact Generator revision.",
        );
      }

      const requested = ensureActionRunRequest(input.doc, input.request);
      if (!requested.ok) generatorMutationFailure(requested.error);
      if (
        requested.run.status === "succeeded" ||
        requested.run.status === "failed"
      ) {
        // A retry of an intentional Run reuses its public identity. Once that
        // identity is terminal it must never recreate owner-private work, even
        // if the old journal has already been compacted or lost. A deliberate
        // rerun uses a new actionRunId.
        return requested.run;
      }

      // The Project request is the public durable intent. Persist it before
      // owner-private task creation makes the Run eligible for execution.
      await input.checkpoint();

      await createLocalDurableRun({
        ownerId: options.ownerId,
        journal: options.journal,
        command: input.command,
      });

      const started = markActionRunStarted(
        input.doc,
        input.request.actionRunId,
      );
      if (!started.ok) generatorMutationFailure(started.error);
      await input.checkpoint();
      return started.run;
    },
    async projectRunning(input) {
      const task = await options.journal.load(input.identity);
      const executorInput = task?.executorInput;
      if (
        !task ||
        task.owner.realm !== "local" ||
        task.owner.id !== options.ownerId ||
        !executorInput ||
        typeof executorInput !== "object" ||
        Array.isArray(executorInput) ||
        executorInput.targetKind !== "generator-action"
      ) {
        throw new Error(
          `Generator Action Run ${input.identity.actionRunId}/${input.identity.outputSlot} has no owner-private task on this Host.`,
        );
      }
      const started = markActionRunStarted(
        input.doc,
        input.identity.actionRunId,
      );
      if (!started.ok) generatorMutationFailure(started.error);
      await input.checkpoint();
      return started.run;
    },
    async publishMediaSuccess(input) {
      // Validate the complete write set on an isolated replica. The live Host
      // remains the only writer, so applying the same set below is one Project
      // mutation and cannot strand a prefix on a contract conflict.
      applyMediaSuccess(input.doc.fork(), input);
      const published = applyMediaSuccess(input.doc, input);
      await input.checkpoint();
      return published;
    },
    async publishDocumentSuccess(input) {
      applyDocumentSuccess(input.doc.fork(), input);
      const published = applyDocumentSuccess(input.doc, input);
      await input.checkpoint();
      return published;
    },
    async publishFailure(input) {
      applyFailure(input.doc.fork(), input.actionRunId);
      const published = applyFailure(input.doc, input.actionRunId);
      await input.checkpoint();
      return published;
    },
  };
}
