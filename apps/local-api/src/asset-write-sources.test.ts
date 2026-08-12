import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const broker = readFileSync(join(__dirname, "local-plugin-broker.ts"), "utf8");
const schema = readFileSync(
  join(__dirname, "../../../packages/shared-types/src/executable-plugin.ts"),
  "utf8",
);

/**
 * Every way of writing an asset either works or is not offered.
 *
 * The schema advertised three sources and the host implemented one:
 *
 *   dataBase64    accepted
 *   url           "Local asset.write currently requires inline dataBase64."
 *   sourceHandle  same error, and nothing anywhere ever produced one -- the
 *                 `clash-plugin-output://` scheme appears in the schema and in a single schema test,
 *                 with no producer, no resolver, and no meaning for what follows the slashes.
 *
 * A plugin author reading the schema would write the url form, ship it, and discover at runtime that
 * two thirds of the documented interface is a wall. That is the same shape as `listFunctionExports`,
 * which was declared optional, implemented nowhere, and refused a real generation that had already
 * been submitted upstream.
 *
 * So: url gets implemented, because upstreams already hand out links and downloading-then-re-encoding
 * makes the bytes cross twice. sourceHandle gets removed, because a name is not a mechanism.
 */
describe("asset.write sources", () => {
  it("no longer advertises a handle nothing can produce", () => {
    expect(schema).not.toMatch(/clash-plugin-output/);
  });

  it("accepts a url and fetches it into the store", () => {
    expect(broker).not.toMatch(/currently requires inline dataBase64/);
    expect(broker).toMatch(/operation\.url/);
  });

  it("still accepts inline bytes", () => {
    expect(broker).toMatch(/operation\.dataBase64/);
  });

  it("refuses a url the plugin says only it can reach", () => {
    // `reach: "private"` means the address resolves inside the plugin's own network. Fetching it
    // from the host is either a 404 or, worse, a request to something on the host's network that the
    // plugin chose -- the plugin naming an address and the host making the request is the SSRF
    // shape.
    expect(broker).toMatch(/reach/);
  });
});
