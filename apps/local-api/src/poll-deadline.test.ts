import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const processor = readFileSync(join(__dirname, "local-processor.ts"), "utf8");

/**
 * Waiting has to end, even when the provider never says so.
 *
 * A plugin decides what its provider's statuses mean, and it does that by listing the words it
 * recognises: eleven of them, for one provider. Everything else — a status a new model introduced, a
 * spelling that differs by a letter, a terminal failure the list never learned — falls through to
 * "not finished yet".
 *
 * While the plugin owned a 300-attempt loop that mistake self-corrected after twenty-five minutes.
 * Now the host schedules the asking, so the same mistake polls forever: a node stays `generating`
 * for a job that died upstream, and the only signal is that nothing ever happens.
 *
 * The host cannot fix the vocabulary — it does not know this provider. What it can do is refuse to
 * wait indefinitely for work it has been told nothing new about.
 */
describe("an accepted generation cannot wait forever", () => {
  it("records when the work was accepted", () => {
    // Without a start there is no age, and without an age there is no deadline.
    expect(processor).toMatch(/providerAcceptedAt/);
  });

  it("fails a generation that outlives its budget", () => {
    expect(processor).toMatch(/providerAcceptedAt[\s\S]{0,600}?status:\s*"failed"/);
  });

  it("says why, naming the provider's silence rather than blaming the model", () => {
    // "Generation failed" would send someone to look at the prompt. The provider stopped answering,
    // or answered something this plugin does not recognise, and that is what to investigate.
    expect(processor).toMatch(/did not reach a final state|stopped reporting|no final status/i);
  });
});
