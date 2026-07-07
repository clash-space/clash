export type AgentHostWriteResult =
  | { ok: true }
  | { ok: false; error: string };

export function assertAgentHostWritePath(options: {
  actorClientType?: string;
  force?: boolean;
  operation: string;
  readCommand: string;
}): AgentHostWriteResult {
  if (options.force || options.actorClientType !== "agent") return { ok: true };
  return {
    ok: false,
    error:
      `Agent ${options.operation} requires a host-verified read receipt. ` +
      "Start `clash canvas connect` or use the local-api host, " +
      `run \`${options.readCommand}\` to get a receipt-bearing readToken, ` +
      "then retry the write with that token. Pass --force only for an explicit overwrite.",
  };
}
