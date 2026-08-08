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
    standalone?: boolean;
    id?: string;
    timelineId?: string;
    sourceTimelineId?: string;
    baseRevisionId?: string;
    name?: string;
    canvasId?: string;
    targetCanvasId?: string;
    nodeId?: string;
    actionNodeId?: string;
    newTimelineId?: string;
    newNodeId?: string;
    newActionNodeId?: string;
    position?: {
        x: number;
        y: number;
    };
    wait?: boolean;
    timeoutMs?: number;
    document?: string | Record<string, unknown>;
    format?: "yaml" | "json" | "object";
    state?: Record<string, unknown>;
};
declare function buildTimelineCliArgs(name: string, input: TimelineToolInput): string[];

type TimelineCommandRunner = (args: string[], cwd: string) => Promise<unknown>;
type TimelineProjectionWriter = (path: string, content: string) => Promise<void>;
type TimelineAdapter = {
    schema(input: TimelineToolInput): Promise<Record<string, unknown>>;
    validate(input: TimelineToolInput): Promise<Record<string, unknown>>;
    list(input: TimelineToolInput): Promise<TimelineEntity[]>;
    get(input: TimelineToolInput): Promise<TimelineEntity>;
    create(input: TimelineToolInput): Promise<unknown>;
    save(input: TimelineToolInput): Promise<Record<string, unknown>>;
    attach(input: TimelineToolInput): Promise<unknown>;
    detach(input: TimelineToolInput): Promise<unknown>;
    copy(input: TimelineToolInput): Promise<unknown>;
    render(input: TimelineToolInput): Promise<Record<string, unknown>>;
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

export { type TimelineAdapter as T, type TimelineCommandRunner as a, type TimelineEntity as b, type TimelineProjectionWriter as c, type TimelineToolInput as d, buildTimelineCliArgs as e, createClashTimelineRunner as f, createTimelineAdapter as g, timelineWorkspaceCwd as t };
