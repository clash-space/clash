import type { ExecutablePluginProviderRegistration } from "@clash/shared-types";
import { ExecutablePluginManifestSchema } from "@clash/shared-types";

/**
 * The Providers a set of installed plugins declares.
 *
 * Extracted from `listProviders`, which required a live session before it would report anything. A
 * freshly installed Provider was therefore invisible until something happened to spawn it, and the
 * dependency was circular: connecting an account reads the declaration to validate the settings,
 * and the plugin is only spawned once it has an account. `--set apiKey=...` answered "this provider
 * does not declare an apiKey setting" for a Provider whose manifest declared exactly that.
 *
 * Reading a declaration is reading a file the installer already validated and hashed. Having a
 * session gates *invoking* the plugin, which is a different question and still checked where
 * invoking happens.
 */

interface LoadedEntry {
  loaded: {
    manifest: unknown;
    providers: Record<string, unknown>;
    schemaHash?: string;
  };
}

export function providerRegistrationsFrom(
  entries: Iterable<LoadedEntry> | Record<string, LoadedEntry>,
): ExecutablePluginProviderRegistration[] {
  const all = Symbol.iterator in Object(entries)
    ? (entries as Iterable<LoadedEntry>)
    : Object.values(entries as Record<string, LoadedEntry>);

  const registrations: ExecutablePluginProviderRegistration[] = [];
  for (const entry of all) {
    const { manifest, providers, schemaHash } = entry.loaded;
    // No hash means the installer never attested it. Reporting its declaration would let an
    // unverified file decide what a settings screen renders.
    // Parsed rather than duck-typed: the loader's own predicate lives in the file this was
    // extracted from, and importing it back would close a cycle.
    const parsed = ExecutablePluginManifestSchema.safeParse(manifest);
    if (!parsed.success || !schemaHash) continue;

    for (const document of Object.values(providers)) {
      registrations.push({
        pluginId: parsed.data.id,
        version: parsed.data.version,
        schemaHash,
        runtime: parsed.data.runtime,
        document,
      } as ExecutablePluginProviderRegistration);
    }
  }
  return registrations;
}
