import { describe, expect, it } from "vitest";

import { BuiltinProviderSchema, MODEL_CARDS } from "./models.js";
import {
  BuiltinModelUpstreamIdSchema,
  BuiltinProviderAccountIdSchema,
  MODEL_PROVIDER_DEFINITIONS,
  MODEL_UPSTREAM_ROUTES,
} from "./model-routing.js";

/**
 * ModelArk is one Volcengine Provider among siblings, not the bare vendor.
 *
 * The Executable Plugin already publishes the ModelArk Provider as
 * `volcengine-modelark` (see `plugins/volcengine/src/stdio.test.ts` and
 * `package.test.ts`, which assert the declared Provider id and upstream id and
 * that "no Provider claims the bare vendor id"). `volcengine-speech` and
 * `volcengine-mediakit` sit at the same level. Shared types must speak that
 * same canonical id, otherwise one Volcengine surface silently owns the vendor
 * namespace and the other siblings cannot be addressed uniformly.
 *
 * `apiShape` is a wire protocol, not a Provider, so it stays `modelark`.
 */

const MODELARK_PROVIDER = "volcengine-modelark";
const BARE_VENDOR = "volcengine";

const isVolcengineish = (value: string | undefined): boolean =>
  typeof value === "string" && value.startsWith(BARE_VENDOR);

describe("Volcengine ModelArk provider identity", () => {
  it("routes every ModelArk wire shape through the volcengine-modelark Provider", () => {
    const modelArkRoutes = MODEL_UPSTREAM_ROUTES.filter((route) => route.apiShape === "modelark");

    expect(modelArkRoutes.length).toBeGreaterThan(0);
    for (const route of modelArkRoutes) {
      expect(route.providerId, route.modelCode).toBe(MODELARK_PROVIDER);
      expect(route.upstreamId, route.modelCode).toBe(MODELARK_PROVIDER);
    }
  });

  it("never names the bare vendor in a runtime route or provider definition", () => {
    for (const route of MODEL_UPSTREAM_ROUTES) {
      expect(route.providerId, route.modelCode).not.toBe(BARE_VENDOR);
      expect(route.upstreamId, route.modelCode).not.toBe(BARE_VENDOR);
    }
    for (const definition of MODEL_PROVIDER_DEFINITIONS) {
      expect(definition.providerId).not.toBe(BARE_VENDOR);
      expect(definition.upstreamId).not.toBe(BARE_VENDOR);
    }
    const definedModelArk = MODEL_PROVIDER_DEFINITIONS.filter(
      (definition) => definition.apiShape === "modelark",
    );
    expect(definedModelArk.length).toBeGreaterThan(0);
    for (const definition of definedModelArk) {
      expect(definition.providerId).toBe(MODELARK_PROVIDER);
      expect(definition.upstreamId).toBe(MODELARK_PROVIDER);
    }
  });

  it("exposes ModelArk Cards under the namespaced Provider only", () => {
    const modelArkCards = MODEL_CARDS.filter((model) =>
      (model.providerImplementations ?? []).some((route) => route.apiShape === "modelark"),
    );

    expect(modelArkCards.length).toBeGreaterThan(0);
    for (const model of modelArkCards) {
      expect(model.availableProviders, model.id).toContain(MODELARK_PROVIDER);
    }
    for (const model of MODEL_CARDS) {
      expect(model.availableProviders ?? [], model.id).not.toContain(BARE_VENDOR);
      expect(model.defaultProvider, model.id).not.toBe(BARE_VENDOR);
    }
  });

  it("keeps every Volcengine sibling namespaced in the builtin schemas", () => {
    const schemas = {
      BuiltinProviderSchema,
      BuiltinModelUpstreamIdSchema,
      BuiltinProviderAccountIdSchema,
    };

    for (const [name, schema] of Object.entries(schemas)) {
      const options = schema.options as readonly string[];
      const volcengine = options.filter(isVolcengineish);

      expect(volcengine, name).toContain(MODELARK_PROVIDER);
      expect(volcengine, name).not.toContain(BARE_VENDOR);
      for (const option of volcengine) {
        expect(option, `${name}:${option}`).toMatch(/^volcengine-[a-z][a-z0-9-]*$/);
      }
    }
  });

  it("leaves the sibling Volcengine speech surface addressable at the same level", () => {
    const speechRoutes = MODEL_UPSTREAM_ROUTES.filter(
      (route) => route.upstreamId === "volcengine-speech",
    );

    expect(speechRoutes.length).toBeGreaterThan(0);
    for (const route of speechRoutes) {
      expect(route.providerId, route.modelCode).toBe("volcengine-speech");
      expect(route.apiShape, route.modelCode).toBe("volcengine-speech");
    }
  });
});
