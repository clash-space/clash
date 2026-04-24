
import { useEffect } from 'react';

// Dev-only: forward browser console output to a server endpoint we can tail
// from the terminal. Activated whenever NODE_ENV !== 'production'.
export default function DevLogBridge() {
    useEffect(() => {
        if (process.env.NODE_ENV === 'production') return;

        const levels: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = ['log', 'info', 'warn', 'error', 'debug'];
        const originals: Record<string, (...args: unknown[]) => void> = {};

        const send = (level: string, args: unknown[]) => {
            try {
                const body = JSON.stringify({
                    level,
                    ts: Date.now(),
                    url: typeof window !== 'undefined' ? window.location.pathname : '',
                    args: args.map(a => {
                        try {
                            if (a instanceof Error) return { __error: true, message: a.message, stack: a.stack };
                            if (typeof a === 'object') return JSON.parse(JSON.stringify(a, (_k, v) =>
                                typeof v === 'bigint' ? v.toString() : v
                            ));
                            return a;
                        } catch { return String(a); }
                    }),
                });
                fetch('/dev-log', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
            } catch { /* ignore */ }
        };

        for (const lvl of levels) {
            const orig = console[lvl].bind(console);
            originals[lvl] = orig;
            (console as unknown as Record<string, unknown>)[lvl] = (...args: unknown[]) => {
                orig(...args);
                send(lvl, args);
            };
        }

        const onError = (e: ErrorEvent) => send('error', [{ msg: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error?.stack }]);
        const onRejection = (e: PromiseRejectionEvent) => send('unhandledrejection', [{ reason: String(e.reason), stack: (e.reason as { stack?: string })?.stack }]);
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);

        return () => {
            for (const lvl of levels) (console as unknown as Record<string, unknown>)[lvl] = originals[lvl];
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }, []);

    return null;
}
