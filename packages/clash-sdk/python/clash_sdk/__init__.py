"""Python helpers for Clash executable plugins and local model runtimes.

Provider and action execution use the clash.plugin/v1 stdio protocol.
The retired ProjectRoom ClashAgent WebSocket transport is intentionally not
exported from this package.
"""

from .executable import ExecutablePluginContext, HostDependencyError, serve

__all__ = ["ExecutablePluginContext", "HostDependencyError", "serve"]
