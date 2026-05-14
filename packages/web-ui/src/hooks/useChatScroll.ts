/**
 * Auto-scroll a chat container to bottom on new content — but only when
 * the user was already at (or near) the bottom. If they've scrolled up
 * to read history, leave them alone; force-scrolling would be the kind
 * of UX hostility that makes group chats unusable.
 *
 * Returns:
 *   - `containerRef`: attach to the scrollable element.
 *   - `isAtBottom`: live boolean; when false, render a "jump to latest"
 *     affordance so the user can opt back in.
 *   - `scrollToBottom()`: imperative jump for that affordance + send-button click.
 *
 * "Near bottom" = within `threshold` px (default 80). Mid-scroll user
 * who's e.g. looking at a tool call from 3 messages ago doesn't get
 * yanked when a new message arrives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_PX = 80;

export function useChatScroll<T>(
  signal: T,
  opts: { threshold?: number } = {},
): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
} {
  const threshold = opts.threshold ?? NEAR_BOTTOM_PX;
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkAtBottom = useCallback((): boolean => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    wasAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // Track scroll position so the next content change knows whether to
  // follow or stay put.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const at = checkAtBottom();
      wasAtBottomRef.current = at;
      setIsAtBottom(at);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [checkAtBottom]);

  // After every render where `signal` changed, follow if user was at
  // bottom before the update. Use rAF so the new content's height is
  // reflected in scrollHeight before we measure.
  useEffect(() => {
    if (!wasAtBottomRef.current) return;
    const id = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [signal]);

  return { containerRef, isAtBottom, scrollToBottom };
}
