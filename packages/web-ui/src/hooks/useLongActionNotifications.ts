import { useEffect, useMemo } from "react";

import {
  createLongActionNotificationTracker,
  sendSystemNotification,
  type ActionNodeSnapshot,
  type SystemNotificationRequest,
} from "../lib/systemNotifications";

export const LONG_ACTION_NOTIFICATION_THRESHOLD_MS = 30_000;

const defaultSend = (notification: SystemNotificationRequest) => {
  void sendSystemNotification(notification);
};

export function useLongActionNotifications(
  nodes: readonly ActionNodeSnapshot[],
  options: {
    thresholdMs?: number;
    now?: () => number;
    send?: (notification: SystemNotificationRequest) => unknown;
  } = {},
): void {
  const thresholdMs =
    options.thresholdMs ?? LONG_ACTION_NOTIFICATION_THRESHOLD_MS;
  const now = options.now ?? Date.now;
  const send = options.send ?? defaultSend;
  const tracker = useMemo(
    () => createLongActionNotificationTracker({ thresholdMs }),
    [thresholdMs],
  );

  useEffect(() => {
    for (const notification of tracker.observe(nodes, now())) {
      void send(notification);
    }
  }, [nodes, now, send, tracker]);
}
