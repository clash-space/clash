import { ProjectHostClient } from '@clash/shared-runtime/project-host-client';

declare const DIRECTOR_PLUGIN_TOOL_NAMES: readonly ["clash_director_open", "clash_director_schema", "clash_director_list", "clash_director_get", "clash_director_capture", "clash_director_create", "clash_director_save", "clash_director_attach", "clash_director_detach", "clash_director_object_add", "clash_director_object_update", "clash_director_object_remove", "clash_director_object_group", "clash_director_object_ungroup", "clash_director_camera_add", "clash_director_camera_update", "clash_director_camera_remove", "clash_director_scene_update", "clash_director_keyframe_upsert", "clash_director_keyframe_remove", "clash_director_action_upsert", "clash_director_action_remove"];
type DirectorPluginToolName = (typeof DIRECTOR_PLUGIN_TOOL_NAMES)[number];
type DirectorEntity = {
    id: string;
    name: string;
    revisionId?: string;
    owner?: {
        kind?: string;
        canvasId?: string;
        actionNodeId?: string;
    };
    state: Record<string, unknown>;
};
type DirectorToolInput = {
    contract?: "state" | "object" | "camera";
    cwd?: string;
    projectId?: string;
    stageId?: string;
    baseRevisionId?: string;
    name?: string;
    canvasId?: string;
    nodeId?: string;
    state?: Record<string, unknown>;
    objectId?: string;
    object?: Record<string, unknown>;
    patch?: Record<string, unknown>;
    objectIds?: string[];
    groupId?: string;
    cameraId?: string;
    camera?: Record<string, unknown>;
    scene?: Record<string, unknown>;
    keyframe?: Record<string, unknown>;
    actionId?: string;
    action?: Record<string, unknown>;
    times?: number[];
    labels?: string[];
    outputDir?: string;
    aspectRatio?: "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
    longEdge?: number;
};
declare function buildDirectorCliArgs(name: string, input: DirectorToolInput): string[];

type DirectorProjectionWriter = (path: string, content: string | Uint8Array) => Promise<void>;
type DirectorAdapter = {
    list(input: DirectorToolInput): Promise<DirectorEntity[]>;
    get(input: DirectorToolInput): Promise<DirectorEntity>;
    capture(input: DirectorToolInput): Promise<unknown>;
    create(input: DirectorToolInput): Promise<unknown>;
    save(input: DirectorToolInput): Promise<Record<string, unknown>>;
    attach(input: DirectorToolInput): Promise<unknown>;
    detach(input: DirectorToolInput): Promise<unknown>;
    mutate(name: DirectorPluginToolName, input: DirectorToolInput): Promise<unknown>;
};
declare function directorWorkspaceCwd(input: DirectorToolInput): string;
/** Director MCP adapter backed directly by local-api with host-issued CAS receipts. */
declare function createDirectorAdapter(options?: {
    client?: ProjectHostClient;
    writeProjection?: DirectorProjectionWriter;
    readRunMedia?: (options: {
        projectId: string;
        actionRunId: string;
        client: ProjectHostClient;
    }) => Promise<{
        projectAssetId: string;
        asset: {
            metadata?: {
                contentType?: string;
                width?: number;
                height?: number;
            };
        };
        bytes: Uint8Array;
    }>;
}): DirectorAdapter;

export { DIRECTOR_PLUGIN_TOOL_NAMES as D, type DirectorAdapter as a, type DirectorEntity as b, type DirectorPluginToolName as c, type DirectorProjectionWriter as d, type DirectorToolInput as e, buildDirectorCliArgs as f, createDirectorAdapter as g, directorWorkspaceCwd as h };
