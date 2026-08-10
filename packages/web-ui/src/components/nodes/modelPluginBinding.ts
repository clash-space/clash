import type { ExecutablePluginBinding } from '@clash/shared-types';

export interface ResolvedModelProjectorBinding {
    binding: ExecutablePluginBinding | undefined;
    persistRouteBinding: boolean;
}

export function preferredModelRoutePluginBinding(route: {
    executorBinding?: ExecutablePluginBinding;
    projectorBinding?: ExecutablePluginBinding;
} | null | undefined): ExecutablePluginBinding | undefined {
    return route?.executorBinding ?? route?.projectorBinding;
}

/**
 * Preserve an immutable historical pin when the route still names the same
 * projector. A route change is a semantic model change, so its current exact
 * binding must replace and persist any unrelated stale pin.
 */
export function resolveModelProjectorBinding(
    storedBinding: ExecutablePluginBinding | undefined,
    routeBinding: ExecutablePluginBinding | undefined,
): ResolvedModelProjectorBinding {
    if (!routeBinding) {
        return { binding: storedBinding, persistRouteBinding: false };
    }
    if (storedBinding
        && storedBinding.pluginId === routeBinding.pluginId
        && storedBinding.exportId === routeBinding.exportId) {
        return { binding: storedBinding, persistRouteBinding: false };
    }
    return { binding: routeBinding, persistRouteBinding: true };
}
