import { describe, expect, it } from 'vitest';

import {
  ExecutablePluginProviderDefinitionSchema,
  resolveModelBindingFromProvider,
  validateExecutablePluginPackage,
} from './executable-plugin.js';

/**
 * A binding says which catalogue model reaches a provider, and under what upstream
 * name. Everything else about the route belongs to the provider.
 *
 * The installed `hilo-hub-media` plugin shows what happens without that split: its
 * 31 bindings repeat `providerId`, `upstreamId`, `apiShape`, `executorExportId`,
 * `requiredOAuth`, and `priority` identically in every file -- 186 duplicated values
 * carrying no information, four of which the provider document already declares.
 * The risk is not verbosity. One mistyped copy produces a route that resolves to the
 * wrong upstream while every other binding looks fine.
 */
const provider = ExecutablePluginProviderDefinitionSchema.parse({
  id: 'hilo-hub',
  name: 'MiniMax Hub',
  upstreamId: 'hilo-hub',
  apiShape: 'hilo-hub',
  executorExportId: 'hilo-hub-execute',
  auth: {
    methods: [{
      id: 'sign-in',
      label: 'Sign in to MiniMax Hub',
      form: [{ kind: 'button', key: 'accessToken', label: 'Sign in' }],
      flow: {
        open: 'https://hub.minimax.io/login',
        callback: { type: 'scheme', scheme: 'minimax-hub' },
      },
    }],
  },
  bindingDefaults: { priority: 5 },
});

describe('binding inheritance', () => {
  it('fills the route from the provider that owns it', () => {
    const resolved = resolveModelBindingFromProvider(
      { modelId: 'gpt-image-2', upstreamModel: 'gpt-image-2' },
      provider,
    );
    expect(resolved).toMatchObject({
      id: 'hilo-hub-gpt-image-2',
      modelId: 'gpt-image-2',
      upstreamModel: 'gpt-image-2',
      providerId: 'hilo-hub',
      upstreamId: 'hilo-hub',
      apiShape: 'hilo-hub',
      executorExportId: 'hilo-hub-execute',
      priority: 5,
    });
  });

  it('no longer derives requiredOAuth, because the provider no longer names acquisitions', () => {
    // Reversed, in two halves that used to be two tests.
    //
    // `requiredOAuth` was read off the provider's auth array: every `oauth`, `derived-token` and
    // `local-token-import` entry carried an `id` naming one acquisition a route had to wait for,
    // de-duplicated because a login page and an import of another app's token were two ways to the
    // same credential. An `api-key` entry carried no id, so a key-only provider inherited nothing.
    //
    // The declarative model has no acquisition ids. A provider declares form keys, an optional
    // browser flow and an optional renewal schedule -- a key is a key whether it is typed or
    // captured, and nothing there is a name a route can wait for. So nothing is inherited, and a
    // binding that needs a route to wait states it, which is what every binding in-tree already did.
    const resolved = resolveModelBindingFromProvider(
      { modelId: 'gpt-image-2', upstreamModel: 'gpt-image-2' },
      provider,
    );
    expect(resolved.requiredOAuth).toBeUndefined();

    const apiKeyProvider = ExecutablePluginProviderDefinitionSchema.parse({
      id: 'acme',
      name: 'Acme',
      upstreamId: 'acme',
      apiShape: 'acme',
      executorExportId: 'acme-execute',
      auth: {
        methods: [{
          id: 'api-key',
          label: 'API key',
          form: [{ kind: 'field', key: 'apiKey', label: 'API key', secret: true }],
        }],
      },
    });
    expect(
      resolveModelBindingFromProvider({ modelId: 'm', upstreamModel: 'M' }, apiKeyProvider)
        .requiredOAuth,
    ).toBeUndefined();
  });

  it('still carries a requiredOAuth the binding states itself', () => {
    // The half that survives. Routing reads `requiredOAuth` against the account's `availableOAuth`
    // to decide whether a route can run, and that is unchanged -- only the inheritance is gone.
    const resolved = resolveModelBindingFromProvider(
      { modelId: 'gpt-image-2', upstreamModel: 'gpt-image-2', requiredOAuth: ['hilo-hub'] },
      provider,
    );
    expect(resolved.requiredOAuth).toEqual(['hilo-hub']);
  });

  it('is equivalent to writing every field out by hand', () => {
    const minimal = resolveModelBindingFromProvider(
      { modelId: 'minimax-h3', upstreamModel: 'MiniMax-H3' },
      provider,
    );
    const expanded = resolveModelBindingFromProvider(
      {
        id: 'hilo-hub-minimax-h3',
        modelId: 'minimax-h3',
        upstreamModel: 'MiniMax-H3',
        providerId: 'hilo-hub',
        upstreamId: 'hilo-hub',
        apiShape: 'hilo-hub',
        executorExportId: 'hilo-hub-execute',
        priority: 5,
      },
      provider,
    );
    expect(minimal).toEqual(expanded);
  });

  it('lets a binding override an inherited value', () => {
    const resolved = resolveModelBindingFromProvider(
      { modelId: 'slow-model', upstreamModel: 'slow', priority: 9 },
      provider,
    );
    expect(resolved.priority).toBe(9);
    expect(resolved.apiShape).toBe('hilo-hub');
  });

  it('keeps binding-specific parameter shaping untouched', () => {
    const resolved = resolveModelBindingFromProvider(
      {
        modelId: 'minimax-h3',
        upstreamModel: 'MiniMax-H3',
        excludedParameterIds: ['background'],
        defaultParamOverrides: { resolution: '2K' },
      },
      provider,
    );
    expect(resolved.excludedParameterIds).toEqual(['background']);
    expect(resolved.defaultParamOverrides).toEqual({ resolution: '2K' });
  });

  it('requires the two facts a binding actually carries', () => {
    expect(() => resolveModelBindingFromProvider({ upstreamModel: 'x' } as never, provider)).toThrow(
      /modelId/,
    );
    expect(() => resolveModelBindingFromProvider({ modelId: 'x' } as never, provider)).toThrow(
      /upstreamModel/,
    );
  });
});

describe('provider binding defaults', () => {
  it('carries the Provider asset delivery contract into every owned binding', () => {
    const providerWithAssetDelivery = ExecutablePluginProviderDefinitionSchema.parse({
      id: 'acme',
      name: 'Acme',
      upstreamId: 'acme',
      apiShape: 'acme',
      executorExportId: 'acme-execute',
      bindingDefaults: {
        assetInputs: [{
          match: { kinds: ['image', 'audio'] },
          representations: ['provider-url', 'bytes'],
        }],
      },
    });

    expect(resolveModelBindingFromProvider(
      { modelId: 'media-model', upstreamModel: 'media-model-v1' },
      providerWithAssetDelivery,
    )).toMatchObject({
      assetInputs: [{
        match: { kinds: ['image', 'audio'] },
        representations: ['provider-url', 'bytes'],
      }],
    });
  });

  it('rejects defaults the binding schema would not accept', () => {
    expect(() =>
      ExecutablePluginProviderDefinitionSchema.parse({
        id: 'acme',
        name: 'Acme',
        upstreamId: 'acme',
        apiShape: 'acme',
        executorExportId: 'acme-execute',
        bindingDefaults: { priority: -1 },
      }),
    ).toThrow();
  });

  it('is optional', () => {
    const parsed = ExecutablePluginProviderDefinitionSchema.parse({
      id: 'acme',
      name: 'Acme',
      upstreamId: 'acme',
      apiShape: 'acme',
      executorExportId: 'acme-execute',
    });
    expect(parsed.bindingDefaults).toBeUndefined();
  });
});

describe('package validation applies inheritance', () => {
  /**
   * The resolver only matters if the loader uses it.
   *
   * A binding trimmed to the two facts it carries has to survive `validateExecutablePluginPackage`
   * and come back with the provider's route filled in. Without that, slimming a plugin's
   * bindings would make the package fail to validate, and the resolver would be a function
   * nothing calls.
   */
  const manifest = {
    apiVersion: 'clash.plugin/v1' as const,
    id: 'acme.slim-hub',
    version: '1.0.0',
    name: 'Slim Hub',
    runtime: {
      kind: 'local' as const,
      transport: 'stdio' as const,
      language: 'node' as const,
      entrypoint: 'handler.mjs',
    },
    contributes: {
      providers: [{ id: 'slim-hub', kind: 'provider' as const, path: 'providers/slim-hub.json' }],
      functions: [{ id: 'slim-hub-execute', kind: 'provider-executor' as const }],
      modelBindings: [{ id: 'slim-hub-flux-2-pro', kind: 'model-provider-binding' as const, path: 'bindings/flux-2-pro.json' }],
    },
  };

  const providerDocument = {
    apiVersion: 'clash.provider/v1' as const,
    kind: 'provider' as const,
    spec: {
      id: 'slim-hub',
      name: 'Slim Hub',
      upstreamId: 'slim-hub',
      apiShape: 'slim-hub',
      executorExportId: 'slim-hub-execute',
      auth: {
        methods: [{
          id: 'sign-in',
          label: 'Sign in to Slim Hub',
          form: [{ kind: 'button' as const, key: 'accessToken', label: 'Sign in' }],
          flow: {
            open: 'https://hub.example/login',
            callback: { type: 'scheme' as const, scheme: 'slim-hub' },
          },
        }],
      },
      bindingDefaults: { priority: 5 },
    },
  };

  it('accepts a binding trimmed to modelId and upstreamModel', () => {
    const validated = validateExecutablePluginPackage(manifest, {}, {}, {
      providers: { 'providers/slim-hub.json': providerDocument },
      modelBindings: {
        'bindings/flux-2-pro.json': {
          apiVersion: 'clash.binding/v1',
          kind: 'model-provider-binding',
          spec: { id: 'slim-hub-flux-2-pro', modelId: 'flux-2-pro', upstreamModel: 'FLUX-2-pro' },
        },
      },
    });

    const spec = validated.modelBindings['bindings/flux-2-pro.json'].spec as Record<string, unknown>;
    expect(spec.providerId).toBe('slim-hub');
    expect(spec.upstreamId).toBe('slim-hub');
    expect(spec.apiShape).toBe('slim-hub');
    expect(spec.executorExportId).toBe('slim-hub-execute');
    // Nothing to inherit: the provider declares a form and a flow, neither of which names an
    // acquisition. A binding that needs a route to wait writes `requiredOAuth` itself.
    expect(spec.requiredOAuth).toBeUndefined();
    expect(spec.priority).toBe(5);
    // The two facts the binding carries are untouched.
    expect(spec.modelId).toBe('flux-2-pro');
    expect(spec.upstreamModel).toBe('FLUX-2-pro');
  });
});
