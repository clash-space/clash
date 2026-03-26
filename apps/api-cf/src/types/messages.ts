export type ClientMessage =
  | {
      type: "context_update";
      projectId: string;
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    }
  | {
      type: "chat";
      projectId: string;
      workspaceGroupId?: string;
      content: string;
    }
  | {
      type: "cancel";
    };
