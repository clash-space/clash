import { useCallback, useEffect, useRef } from 'react';
import { useMoveGesture } from '../ui/gesture';

export type AgentMotionState = 'idle' | 'connecting' | 'working' | 'waiting' | 'failed' | 'review';

export type AgentMotionProps = {
    state?: AgentMotionState;
    className?: string;
    label?: string;
    decorative?: boolean;
    gazeTarget?: { x: number; y: number } | null;
    gazeSource?: AgentGazeSource | null;
};
type GazePoint = { x: number; y: number };

export type AgentGazeSource = {
    subscribe: (listener: (point: GazePoint) => void) => () => void;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
    return classes.filter(Boolean).join(' ');
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

/**
 * Publishes one pointer stream for a whole agent surface. Consumers update
 * their eye transforms imperatively, so a moving pointer neither installs one
 * surface listener per persona nor re-renders the transcript on every frame.
 */
export function useAgentGazeSurface() {
    const listenersRef = useRef(new Set<(point: GazePoint) => void>());
    const gazeSourceRef = useRef<AgentGazeSource | null>(null);
    if (!gazeSourceRef.current) {
        gazeSourceRef.current = {
            subscribe: (listener) => {
                listenersRef.current.add(listener);
                return () => listenersRef.current.delete(listener);
            },
        };
    }

    const bindAgentGazeSurface = useMoveGesture<PointerEvent>(({ event }) => {
        if (prefersReducedMotion()) return;
        const point = { x: event.clientX, y: event.clientY };
        for (const listener of listenersRef.current) listener(point);
    }, {
        eventOptions: { passive: true },
        triggerAllEvents: true,
    });

    return {
        bindAgentGazeSurface,
        gazeSource: gazeSourceRef.current,
    };
}

export function AgentMotion({
    state = 'idle',
    className,
    label = 'Clash agent',
    decorative = true,
    gazeTarget = null,
    gazeSource = null,
}: AgentMotionProps) {
    const rootRef = useRef<HTMLSpanElement>(null);
    const frameRef = useRef(0);
    const lastPointerRef = useRef<GazePoint | null>(null);

    const accessibilityProps = decorative
        ? { 'aria-hidden': true as const }
        : { role: 'img' as const, 'aria-label': label };

    const reset = useCallback(() => {
        const root = rootRef.current;
        if (!root) return;
        root.dataset.agentMotionTracking = 'false';
        root.style.setProperty('--clash-agent-eye-x', '0px');
        root.style.setProperty('--clash-agent-eye-y', '0px');
    }, []);

    const updateEyes = useCallback((point: GazePoint) => {
        const root = rootRef.current;
        if (!root) return;

        const rect = root.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const rangeX = Math.max(rect.width * 0.55, 1);
        const rangeY = Math.max(rect.height * 0.6, 1);
        const normalizedX = clamp((point.x - centerX) / rangeX, -1, 1);
        const normalizedY = clamp((point.y - centerY) / rangeY, -1, 1);
        const maxX = clamp(rect.width * 0.2, 4, 14);
        const maxY = clamp(rect.height * 0.15, 3, 10);

        root.dataset.agentMotionTracking = 'true';
        root.style.setProperty('--clash-agent-eye-x', `${(normalizedX * maxX).toFixed(2)}px`);
        root.style.setProperty('--clash-agent-eye-y', `${(normalizedY * maxY).toFixed(2)}px`);
    }, []);

    const schedulePointerUpdate = useCallback((point: GazePoint) => {
        if (typeof window === 'undefined') return;
        lastPointerRef.current = point;
        if (frameRef.current !== 0) return;
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = 0;
            const latest = lastPointerRef.current;
            if (latest) updateEyes(latest);
        });
    }, [updateEyes]);

    const bindAgentGaze = useMoveGesture<PointerEvent>(({ event }) => {
        if (prefersReducedMotion()) return;
        schedulePointerUpdate({ x: event.clientX, y: event.clientY });
    }, {
        eventOptions: { passive: true },
        triggerAllEvents: true,
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (prefersReducedMotion()) return;

        window.addEventListener('blur', reset);

        return () => {
            window.removeEventListener('blur', reset);
            if (frameRef.current !== 0) {
                window.cancelAnimationFrame(frameRef.current);
                frameRef.current = 0;
            }
        };
    }, [reset]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (prefersReducedMotion()) return;
        if (state !== 'idle' || !gazeTarget) return;

        updateEyes(gazeTarget);
    }, [gazeTarget, state, updateEyes]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (prefersReducedMotion()) return;
        if (state !== 'idle' || !gazeSource) return;

        return gazeSource.subscribe(schedulePointerUpdate);
    }, [gazeSource, schedulePointerUpdate, state]);

    return (
        <span
            ref={rootRef}
            className={joinClasses('clash-agent-motion', `clash-agent-motion--${state}`, className)}
            data-slot="clash-agent-avatar"
            data-status={state}
            data-agent-motion-state={state}
            data-agent-motion-tracking="false"
            {...accessibilityProps}
            {...bindAgentGaze()}
        >
            <svg
                className="clash-agent-motion__svg"
                viewBox="0 0 512 512"
                focusable="false"
            >
                <g className="clash-agent-motion__avatar">
                    <path
                        className="clash-agent-motion__frame"
                        d="M 452.6 234.5
                           L 452.6 95.3
                           A 56.8 58.6 0 0 0 395.8 36.8
                           L 117.4 36.8
                           A 58.6 58.6 0 0 0 58.6 95.3
                           L 58.6 384.2
                           A 58 57.4 0 0 0 117.4 441.6
                           L 333.1 441.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="30"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength="1000"
                    />
                    <g className="clash-agent-motion__gaze">
                        <ellipse className="clash-agent-motion__eye clash-agent-motion__eye-left" cx="200.9" cy="227" rx="27.3" ry="47.6" />
                        <ellipse className="clash-agent-motion__eye clash-agent-motion__eye-right" cx="308.2" cy="227" rx="27.3" ry="47.6" />
                    </g>
                    <path
                        className="clash-agent-motion__attached-mark"
                        d="M 367.9 421.3 Q 379.5 398.1 398.1 371.4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="12"
                        strokeLinecap="round"
                        pathLength="120"
                    />
                    <rect
                        className="clash-agent-motion__pen"
                        x="392.3"
                        y="253.1"
                        width="51"
                        height="215.8"
                        rx="25.5"
                        ry="25.5"
                    />
                </g>
            </svg>
        </span>
    );
}
