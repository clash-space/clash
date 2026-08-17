import { Notification } from "electron";

export interface DesktopSystemNotificationRequest {
  title: string;
  body: string;
}

interface DesktopNotificationHandle {
  onClick: (listener: () => void) => void;
  show: () => void;
}

export interface DesktopNotificationAdapter {
  isSupported: () => boolean;
  create: (
    options: DesktopSystemNotificationRequest,
  ) => DesktopNotificationHandle;
}

interface NotificationSourceWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
}

const electronNotificationAdapter: DesktopNotificationAdapter = {
  isSupported: () => Notification.isSupported(),
  create: (options) => {
    const notification = new Notification(options);
    return {
      onClick: (listener) => notification.on("click", listener),
      show: () => notification.show(),
    };
  },
};

function notificationRequest(
  value: unknown,
): DesktopSystemNotificationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  const title = typeof request.title === "string" ? request.title.trim() : "";
  const body = typeof request.body === "string" ? request.body.trim() : "";
  return title && body ? { title, body } : null;
}

export function showDesktopSystemNotification(
  requestValue: unknown,
  sourceWindow?: NotificationSourceWindow,
  adapter: DesktopNotificationAdapter = electronNotificationAdapter,
): boolean {
  const request = notificationRequest(requestValue);
  if (!request || !adapter.isSupported()) return false;

  const notification = adapter.create(request);
  notification.onClick(() => {
    if (!sourceWindow || sourceWindow.isDestroyed()) return;
    if (sourceWindow.isMinimized()) sourceWindow.restore();
    sourceWindow.show();
    sourceWindow.focus();
  });
  notification.show();
  return true;
}
