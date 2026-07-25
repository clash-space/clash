export const TIMELINE_NOTICE_EVENT = 'clash:timeline-notice';

export function emitTimelineNotice(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(TIMELINE_NOTICE_EVENT, { detail: message }));
}
