import test from "node:test";
import assert from "node:assert/strict";
import { providerPayloadFromOptions } from "./models";

test("builds a provider account payload from CLI options", () => {
  assert.deepEqual(providerPayloadFromOptions("official", {
    upstream: "openai",
    region: "global",
    weight: "80",
    priority: "2",
  }), {
    providerId: "official",
    upstreamId: "openai",
    region: "global",
    enabled: true,
    weight: 80,
    priority: 2,
  });
});

test("can disable a provider account from CLI options", () => {
  assert.deepEqual(providerPayloadFromOptions("fal", {
    disable: true,
  }), {
    providerId: "fal",
    enabled: false,
  });
});
