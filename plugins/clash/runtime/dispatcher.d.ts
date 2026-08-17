type ClashEntrypoint = "cli" | "mcp" | "openma-mcp";
type ClashEntrypointLoaders = {
    cli(): Promise<unknown>;
    mcp(): Promise<unknown>;
    "openma-mcp"(): Promise<unknown>;
};
declare function resolveClashDistributionVersion(moduleUrl?: string): string | undefined;
declare function normalizeClashArgv(argv?: readonly string[]): string[];
declare function selectClashEntrypoint(argv?: readonly string[]): ClashEntrypoint;
declare function runClashEntrypoint(argv?: readonly string[], loaders?: ClashEntrypointLoaders): Promise<void>;
declare function isDirectExecution(moduleUrl: string, argvEntry?: string, cwd?: string): boolean;

export { type ClashEntrypoint, type ClashEntrypointLoaders, isDirectExecution, normalizeClashArgv, resolveClashDistributionVersion, runClashEntrypoint, selectClashEntrypoint };
