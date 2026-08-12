export type AgentHostWriteResult =
  | { ok: true }
  | { ok: false; error: string };

export function assertAgentHostWritePath(options: {
  actorClientType?: string;
  operation: string;
  readCommand: string;
}): AgentHostWriteResult {
  if (options.actorClientType !== "agent") return { ok: true };
  return {
    ok: false,
    error:
      `Agent ${options.operation} requires the local host to verify the cwd observation. ` +
      "Start the local-api host, " +
      `run \`${options.readCommand}\`, then retry the write.`,
  };
}
