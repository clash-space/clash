'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Sparkle, Check, X } from '@phosphor-icons/react';
import betterAuthClient from '@/lib/betterAuthClient';

function CliAuthContent() {
    const searchParams = useSearchParams();
    const redirectUri = searchParams.get('redirect_uri');
    const [status, setStatus] = useState<'loading' | 'confirming' | 'success' | 'error'>('loading');
    const [error, setError] = useState('');

    const session = betterAuthClient.useSession();
    const user = session.data?.user;

    const handleAuthorize = useCallback(async () => {
        if (!redirectUri) {
            setError('Missing redirect_uri');
            setStatus('error');
            return;
        }

        try {
            const res = await fetch('/api/v1/cli-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenName: 'CLI Login' }),
            });

            if (!res.ok) {
                const body = await res.text();
                throw new Error(body || `HTTP ${res.status}`);
            }

            const { token } = await res.json();
            setStatus('success');

            // Redirect back to CLI's localhost server
            const url = new URL(redirectUri);
            url.searchParams.set('token', token);
            window.location.href = url.toString();
        } catch (err: any) {
            setError(err.message || 'Failed to create token');
            setStatus('error');
        }
    }, [redirectUri]);

    useEffect(() => {
        if (session.isPending) return;
        if (!user) {
            // Not logged in → redirect to login with return URL
            window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.href)}`;
            return;
        }
        setStatus('confirming');
    }, [user, session.isPending]);

    if (status === 'loading') {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-white px-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-sm text-center"
            >
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
                    {status === 'success' ? (
                        <Check className="h-8 w-8 text-green-600" weight="bold" />
                    ) : status === 'error' ? (
                        <X className="h-8 w-8 text-red-600" weight="bold" />
                    ) : (
                        <Sparkle className="h-8 w-8 text-brand" weight="fill" />
                    )}
                </div>

                {status === 'confirming' && (
                    <>
                        <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">
                            Authorize CLI
                        </h1>
                        <p className="text-gray-500 mb-1">
                            Signed in as <span className="font-medium text-gray-900">{user?.name || user?.email}</span>
                        </p>
                        <p className="text-sm text-gray-400 mb-8">
                            This will create an API token for CLI access.
                        </p>
                        <motion.button
                            onClick={handleAuthorize}
                            className="w-full rounded-full bg-gray-900 px-6 py-3 text-base font-medium text-white hover:bg-gray-800 transition-colors"
                            whileTap={{ scale: 0.98 }}
                        >
                            Authorize
                        </motion.button>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">
                            Authenticated!
                        </h1>
                        <p className="text-gray-500">
                            Redirecting back to the CLI...
                        </p>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <h1 className="font-display text-2xl font-bold text-red-600 mb-2">
                            Authentication Failed
                        </h1>
                        <p className="text-gray-500">{error}</p>
                    </>
                )}
            </motion.div>
        </div>
    );
}

export default function CliAuthPage() {
    return (
        <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            </div>
        }>
            <CliAuthContent />
        </Suspense>
    );
}
