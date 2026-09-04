import { LoroDoc } from "loro-crdt";

import type { StateAdapter } from "./replica-engine";

function importUpdate(doc: LoroDoc, update: Uint8Array): void {
  if (update.byteLength > 0) doc.import(update);
}

export class LoroStateAdapter implements StateAdapter<
  LoroDoc,
  Uint8Array,
  Uint8Array
> {
  create(): LoroDoc {
    return new LoroDoc();
  }

  restore(checkpoint: Uint8Array): LoroDoc {
    const doc = new LoroDoc();
    importUpdate(doc, checkpoint);
    return doc;
  }

  validate(state: LoroDoc, update: Uint8Array): void {
    const candidate = state.fork();
    try {
      importUpdate(candidate, update);
    } finally {
      candidate.free();
    }
  }

  apply(state: LoroDoc, update: Uint8Array): void {
    importUpdate(state, update);
  }

  checkpoint(state: LoroDoc): Uint8Array {
    // A checkpoint is also the base for clients that may have edited offline.
    // Shallow snapshots are only safe once a product has chosen a GC frontier
    // that no admitted replica can predate; the generic core cannot assume it.
    return state.export({ mode: "snapshot" });
  }
}
