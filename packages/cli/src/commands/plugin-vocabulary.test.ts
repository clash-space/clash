import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pluginCommand } from "./plugin.js";
import { managedStorageDraftHint } from "../lib/plugin-draft-location.js";

/**
 * The command is named for the thing it manages.
 *
 * It was `clash action`, from a time when a plugin was one "action" among canvas actions. Every
 * other surface moved on: the manifest declares `clash.plugin/v1`, ids are `publisher.name`, the
 * source lives in `plugins/`, the types are `pluginId` and `PluginBroker`, and this command's own
 * description already said "executable plugins".
 *
 * The clearest evidence was `clash action init-plugin`, where the noun appeared twice in two
 * vocabularies for one thing -- a user reading it has to guess whether an action and a plugin are
 * the same, and the answer is that they are.
 */
describe("clash plugin", () => {
  it("is named plugin", () => {
    expect(pluginCommand.name()).toBe("plugin");
  });

  it("creates a draft with create, not init or init-plugin", () => {
    // `plugin init-plugin` repeated the noun the command already carries. `init` was no better:
    // the argument is a directory that must not already exist, so this makes a new thing rather
    // than initialising the one you are standing in -- the line `npm init` and `npm create` draw.
    const names = pluginCommand.commands.map((command) => command.name());
    expect(names).toContain("create");
    expect(names).not.toContain("init");
    expect(names).not.toContain("init-plugin");
  });

  it("keeps the operations that install and attest a plugin", () => {
    // The rename is vocabulary, not scope. Losing one of these silently would leave a documented
    // path -- `clash plugin activate <dir>` is what the refusal message tells a user to run --
    // pointing at a command that no longer exists.
    const names = pluginCommand.commands.map((command) => command.name());
    for (const required of ["activate", "checkout", "validate", "list"]) {
      expect(names).toContain(required);
    }
  });

  it("describes itself in one vocabulary", () => {
    // The description said "executable plugins and canvas actions", which is the split this rename
    // removes.
    expect(pluginCommand.description()).not.toMatch(/canvas actions/i);
    expect(pluginCommand.description()).toMatch(/plugin/i);
  });

  it("only ever tells a user to run a command that exists", () => {
    // The rename's whole failure mode, caught twice for real. First when `clash action activate`
    // refused a bad draft directory and named three `clash action ...` commands that no longer
    // existed. Then again during the rename itself: the hint was updated to `clash plugin init`
    // while the subcommand had settled on `create`, so the refusal still sent the reader nowhere.
    //
    // Checking the strings against the command's own subcommand list means the two cannot drift
    // apart silently again -- the message is only as good as the command it names.
    const declared = new Set(pluginCommand.commands.map((command) => command.name()));
    const sources = [
      managedStorageDraftHint(),
      readFileSync(join(__dirname, "plugin.ts"), "utf8"),
    ];

    const referenced = new Set<string>();
    for (const source of sources) {
      for (const [, sub] of source.matchAll(/clash plugin ([a-z-]+)/g)) referenced.add(sub);
    }

    expect(referenced.size).toBeGreaterThan(0);
    for (const sub of referenced) {
      expect(declared, `\`clash plugin ${sub}\` is advertised but not defined`).toContain(sub);
    }
  });

  it("never advertises the old command name", () => {
    // `clash action ...` in a message is a dead end now: the command is gone, so a user who copies
    // it gets "unknown command". Past-tense narrative in comments is fine; an emitted string is not.
    const source = readFileSync(join(__dirname, "plugin.ts"), "utf8");
    const emitted = [...source.matchAll(/["`][^"`\n]*clash action [^"`\n]*["`]/g)].map((m) => m[0]);
    expect(emitted).toEqual([]);
  });
});
