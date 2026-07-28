declare const TIMELINE_PLUGIN_TOOL_NAMES: readonly ["clash_timeline_open", "clash_timeline_list", "clash_timeline_get", "clash_timeline_create", "clash_timeline_save", "clash_timeline_attach", "clash_timeline_detach", "clash_timeline_copy"];
type TimelinePluginToolName = (typeof TIMELINE_PLUGIN_TOOL_NAMES)[number];
type TimelineEntity = {
    id: string;
    name: string;
    revisionId?: string;
    owner?: {
        kind?: string;
        canvasId?: string;
        actionNodeId?: string;
    };
    state: unknown;
};
type TimelineToolInput = {
    cwd?: string;
    projectId?: string;
    timelineId?: string;
    name?: string;
    canvasId?: string;
    nodeId?: string;
    newTimelineId?: string;
    newNodeId?: string;
    state?: Record<string, unknown>;
};
declare function buildTimelineCliArgs(name: string, input: TimelineToolInput): string[];

type TimelineCommandRunner = (args: string[], cwd: string) => Promise<unknown>;
type TimelineProjectionWriter = (path: string, content: string) => Promise<void>;
type TimelineAdapter = {
    list(input: TimelineToolInput): Promise<TimelineEntity[]>;
    get(input: TimelineToolInput): Promise<TimelineEntity>;
    create(input: TimelineToolInput): Promise<unknown>;
    save(input: TimelineToolInput): Promise<Record<string, unknown>>;
    attach(input: TimelineToolInput): Promise<unknown>;
    detach(input: TimelineToolInput): Promise<unknown>;
    copy(input: TimelineToolInput): Promise<unknown>;
};
declare function timelineWorkspaceCwd(input: TimelineToolInput): string;
declare function createClashTimelineRunner(options?: {
    command?: string;
    argsPrefix?: string[];
    env?: NodeJS.ProcessEnv;
}): TimelineCommandRunner;
declare function createTimelineAdapter(options?: {
    run?: TimelineCommandRunner;
    writeProjection?: TimelineProjectionWriter;
}): TimelineAdapter;

export { TIMELINE_PLUGIN_TOOL_NAMES as T, type TimelineAdapter as a, type TimelineCommandRunner as b, type TimelineEntity as c, type TimelinePluginToolName as d, type TimelineProjectionWriter as e, type TimelineToolInput as f, buildTimelineCliArgs as g, createClashTimelineRunner as h, createTimelineAdapter as i, timelineWorkspaceCwd as t };
