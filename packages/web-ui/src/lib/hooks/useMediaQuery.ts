import { useEffect, useState } from 'react';

/**
 * Reactive media-query hook.
 *
 * SSR-safe: returns `false` on the server, then syncs to the real
 * match on mount and on every subsequent change.
 *
 * Pass a standard CSS media query, e.g. `'(max-width: 1023.98px)'`
 * (anything below Tailwind's `lg` breakpoint).
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState<boolean>(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia(query).matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia(query);
        const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
        // Sync on mount in case the initial state was stale (StrictMode double-mount,
        // or a server-rendered `false` that no longer matches the client viewport).
        setMatches(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [query]);

    return matches;
}

/** Convenience: matches Tailwind's `< lg` (≤ 1023.98px). */
export function useIsBelowLg(): boolean {
    return useMediaQuery('(max-width: 1023.98px)');
}
