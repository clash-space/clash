import type { PresenceClient } from "@clash/shared-types";

export function visiblePresenceClients(
  clients: PresenceClient[],
  currentUserId: string,
): PresenceClient[] {
  return clients.filter((client) =>
    client.userId !== currentUserId || client.clientType === "agent" || client.clientType === "cli"
  );
}
