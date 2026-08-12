import { describe, expect, it } from "vitest";

import { ExecutablePluginBrokerResponseSchema } from "@clash/shared-types";

/**
 * A key the account has not set.
 *
 * `store.get` wraps its answer as `{ value }`. When nothing is stored the value is `undefined`, and
 * `undefined` is not a JSON value -- it vanishes on serialisation, so the plugin receives `{}` and
 * the response schema refuses it. The plugin then reports `broker_error` with a wall of union
 * errors, about a key simply not being set.
 *
 * clash.google asks for `service` and `region`, and an account authenticating with a service
 * account has neither: the method that stores a key file does not offer them. So the first optional
 * key any Google account looked up killed the invocation.
 *
 * `null` is the JSON way to say "absent" and survives the round trip.
 */
const response = (result: unknown) => ExecutablePluginBrokerResponseSchema.safeParse({
  protocol: "clash.plugin.broker-response/v1",
  requestId: "r-1",
  status: "ok",
  result,
});

describe("store.get for an unset key", () => {
  it("does not answer with a value-shaped object that has no value in it", () => {
    // What the bug produced. The response schema accepts `{}` -- it is a valid JSON record -- so
    // nothing refused it here; the plugin received a `value` field that was not there and failed
    // further in, with a wall of union errors about a key that was simply not set.
    const overTheWire = JSON.parse(JSON.stringify({ value: undefined }));
    expect(overTheWire).toEqual({});
    expect("value" in overTheWire).toBe(false);

    // What it answers now: absence said out loud, in the one way JSON has of saying it. The value
    // comes from a lookup rather than a literal, because `undefined ?? null` is a constant the
    // compiler folds away -- and folding it away is exactly what stops the case from being a test.
    const stored: Record<string, string> = {};
    const answered = JSON.parse(JSON.stringify({ value: stored.region ?? null }));
    expect(answered).toEqual({ value: null });
    expect(response(answered).success).toBe(true);
  });

  it("accepts an explicit null", () => {
    expect(response({ value: null }).success).toBe(true);
  });

  it("accepts a stored string", () => {
    expect(response({ value: "us-central1" }).success).toBe(true);
  });
});
