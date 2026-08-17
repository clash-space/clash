export interface SystemNotificationRequest {
  title: string;
  body: string;
}

export interface SystemNotificationBridge {
  notify: (request: SystemNotificationRequest) => Promise<{ shown: boolean }>;
}

export type ActionNodeSnapshot = {
  id: string;
  type?: string;
  data?: {
    label?: unknown;
    status?: unknown;
    pendingTaskAt?: unknown;
  };
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function desktopNotificationBridge(): SystemNotificationBridge | undefined {
  const desktop = (
    globalThis as typeof globalThis & {
      __CLASH_DESKTOP__?: { notify?: SystemNotificationBridge["notify"] };
    }
  ).__CLASH_DESKTOP__;
  return desktop?.notify ? { notify: desktop.notify } : undefined;
}

export async function sendSystemNotification(
  request: SystemNotificationRequest,
  bridge: SystemNotificationBridge | undefined = desktopNotificationBridge(),
): Promise<boolean> {
  if (!bridge) return false;
  try {
    return (await bridge.notify(request)).shown;
  } catch {
    return false;
  }
}

export function notificationForAgentEvent(
  value: unknown,
): SystemNotificationRequest | null {
  const event = recordValue(value);
  const type = nonEmptyString(event?.type);
  if (type === "session.permission_request") {
    const toolCall = recordValue(event?.tool_call);
    return {
      title: "Agent needs approval",
      body:
        nonEmptyString(toolCall?.title) ??
        nonEmptyString(toolCall?.name) ??
        "An action is waiting for your approval.",
    };
  }
  if (type === "session.complete") {
    return {
      title: "Agent finished",
      body: "The current task is ready to review.",
    };
  }
  if (type === "session.error") {
    return {
      title: "Agent stopped",
      body:
        nonEmptyString(event?.message) ??
        "The current task could not be completed.",
    };
  }
  return null;
}

export function createLongActionNotificationTracker({
  thresholdMs,
}: {
  thresholdMs: number;
}) {
  const startedAtByNode = new Map<string, number>();
  const terminalNodeIds = new Set<string>();

  return {
    observe(
      nodes: readonly ActionNodeSnapshot[],
      now = Date.now(),
    ): SystemNotificationRequest[] {
      const notifications: SystemNotificationRequest[] = [];
      const presentIds = new Set(nodes.map((node) => node.id));

      for (const node of nodes) {
        const status = node.data?.status;
        if (status === "pending" || status === "generating") {
          if (!terminalNodeIds.has(node.id)) {
            const pendingTaskAt = node.data?.pendingTaskAt;
            const observedStart =
              typeof pendingTaskAt === "number" &&
              Number.isFinite(pendingTaskAt) &&
              pendingTaskAt >= 0 &&
              pendingTaskAt <= now
                ? pendingTaskAt
                : now;
            const currentStart = startedAtByNode.get(node.id);
            if (currentStart === undefined || observedStart < currentStart) {
              startedAtByNode.set(node.id, observedStart);
            }
          }
          continue;
        }
        if (status !== "completed" && status !== "failed") continue;
        if (terminalNodeIds.has(node.id)) continue;

        const startedAt = startedAtByNode.get(node.id);
        if (startedAt === undefined) {
          terminalNodeIds.add(node.id);
          continue;
        }

        startedAtByNode.delete(node.id);
        terminalNodeIds.add(node.id);
        if (now - startedAt < thresholdMs) continue;

        const label = nonEmptyString(node.data?.label) ?? "Action";
        notifications.push(
          status === "completed"
            ? { title: "Action completed", body: `${label} is ready.` }
            : { title: "Action failed", body: `${label} needs attention.` },
        );
      }

      for (const nodeId of startedAtByNode.keys()) {
        if (!presentIds.has(nodeId)) startedAtByNode.delete(nodeId);
      }
      for (const nodeId of terminalNodeIds) {
        if (!presentIds.has(nodeId)) terminalNodeIds.delete(nodeId);
      }

      return notifications;
    },
  };
}
