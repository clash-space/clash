import { describe, expect, it } from "vitest";

import { pluginIdSchema } from "@clash/shared-types";

/**
 * The scaffold cannot emit a plugin that will not install.
 *
 * `clash plugin create <dir> --id <id>` writes the id straight into `manifest.json`. Before
 * the id rule existed, a single-segment id produced a package that validated locally and then
 * failed at activation with a schema error naming a regex -- the kind of message that sends an
 * author looking in the wrong file.
 *
 * Failing here instead means the mistake is caught while the author is still typing the command
 * that made it.
 */
describe("scaffolded plugin ids", () => {
  it("refuses a bare name and says what to write instead", () => {
    const result = pluginIdSchema.safeParse("my-plugin");
    expect(result.success).toBe(false);
    if (result.success) return;
    // The message has to carry the fix. "Invalid" does not tell an author that a publisher is
    // missing, and the regex does not either.
    expect(result.error.issues[0]!.message).toMatch(/publisher\.name/);
    expect(result.error.issues[0]!.message).toMatch(/clash\.google/);
  });

  it("accepts what the docs tell an author to write", () => {
    for (const id of ["clash.google", "clash.minimax", "local-dev.demo", "acme.video-tools"]) {
      expect(pluginIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("accepts the placeholder publisher the docs suggest for local work", () => {
    // An author does not have a publisher on day one, and blocking on that would mean registering a
    // name before writing a line of code.
    expect(pluginIdSchema.safeParse("local-dev.my-plugin").success).toBe(true);
  });
});
