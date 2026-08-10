import { describe, expect, it } from 'vitest';

import {
  ExecutablePluginProviderDefinitionSchema,
  resolveModelBindingFromProvider,
  validateExecutablePluginPackage,
} from './executable-plugin';

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
  auth: [
    {
      type: 'oauth',
      id: 'hilo-hub',
      flow: 'browser',
      authorizationUrl: 'https://hub.minimax.io/login',
      callback: { type: 'custom-scheme', scheme: 'minimax-hub' },
    },
  ],
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
      requiredOAuth: ['hilo-hub'],
      priority: 5,
    });
  });

  it('derives requiredOAuth from the provider auth it declares', () => {
    // The provider already states how it authenticates; repeating that per binding
    // is how the two drift apart.
    const apiKeyProvider = ExecutablePluginProviderDefinitionSchema.parse({
      id: 'acme',
      name: 'Acme',
      upstreamId: 'acme',
      apiShape: 'acme',
      executorExportId: 'acme-execute',
      auth: [{ type: 'api-key' }],
    });
    const resolved = resolveModelBindingFromProvider({ modelId: 'm', upstreamModel: 'M' }, apiKeyProvider);
    expect(resolved.requiredOAuth).toBeUndefined();
  });


  it('names each credential once when several acquisitions share it', () => {
    // A login page and an import of another app's stored token are two ways to obtain the
    // same credential, so they carry the same id. Listing both produced
    // `["hilo-hub", "hilo-hub"]`, which is not what any hand-written binding said.
    const resolved = resolveModelBindingFromProvider({ modelId: 'm', upstreamModel: 'M' }, {
      id: 'hub', name: 'Hub', upstreamId: 'hub', apiShape: 'hub', executorExportId: 'hub-execute',
      auth: [
        { type: 'oauth', id: 'hub', flow: 'browser', authorizationUrl: 'https://hub.example/login',
          callback: { type: 'custom-scheme', scheme: 'hub' }, accessTokenField: 'accessToken' },
        { type: 'local-token-import', id: 'hub', source: {
          format: 'electron-store-aes-256-gcm-v2', appDataSubdirectory: 'a',
          configFile: 'c.json', keyFile: 'k', tokenPath: ['t'] } },
        // An api-key is the credential itself, not a named acquisition to wait for.
        { type: 'api-key', credentialId: 'apiKey' },
      ],
    } as never);
    expect(resolved.requiredOAuth).toEqual(['hub']);
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
        requiredOAuth: ['hilo-hub'],
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
    id: 'slim-hub',
    version: '1.0.0',
    name: 'Slim Hub',
    runtime: {
      kind: 'local' as const,
      transport: 'stdio' as const,
      language: 'node' as const,
      entrypoint: 'handler.mjs',
    },
    exports: {
      providers: [{ id: 'slim-hub', kind: 'provider' as const, path: 'providers/slim-hub.json' }],
      functions: [{ id: 'slim-hub-execute', kind: 'provider-executor' as const, handler: 'run' }],
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
      auth: [{ type: 'oauth' as const, id: 'slim-hub', flow: 'browser' as const,
        authorizationUrl: 'https://hub.example/login',
        callback: { type: 'custom-scheme' as const, scheme: 'slim-hub' } }],
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
    expect(spec.requiredOAuth).toEqual(['slim-hub']);
    expect(spec.priority).toBe(5);
    // The two facts the binding carries are untouched.
    expect(spec.modelId).toBe('flux-2-pro');
    expect(spec.upstreamModel).toBe('FLUX-2-pro');
  });
});
