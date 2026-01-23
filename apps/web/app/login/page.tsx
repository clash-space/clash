'use client';

import { motion } from 'framer-motion';
import { GoogleLogo } from '@phosphor-icons/react';
import betterAuthClient from '@/lib/betterAuthClient';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import Background from '../components/Background';

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const session = betterAuthClient.useSession();

  useEffect(() => {
    if (session.data?.user) {
      router.push('/');
    }
  }, [session.data, router]);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await betterAuthClient.signIn.social({
        provider: 'google',
        callbackURL: '/',
      });
    } catch (error) {
      console.error('Sign in error:', error);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white relative overflow-hidden">
       {/* Global Artistic Background */}
       <Background />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md px-8 relative z-10"
      >
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block group mb-6">
            <motion.div
              className="flex items-center justify-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
               <span className="font-display text-5xl font-bold tracking-tighter text-gray-900 leading-none">
                Clash
              </span>
              <div className="h-10 w-[7px] bg-brand -skew-x-[20deg] transform origin-center" />
            </motion.div>
          </Link>
          <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">
            Welcome back
          </h1>
          <p className="text-gray-600">
            Sign in to your account to continue
          </p>
        </div>

        <div className="space-y-4">
          <motion.button
            onClick={handleSignIn}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-3 rounded-full bg-gray-900 px-6 py-4 text-base font-medium text-white transition-all hover:bg-gray-800 shadow-lg shadow-gray-900/20 disabled:opacity-70 disabled:cursor-not-allowed"
            whileHover={!isLoading ? { scale: 1.02 } : {}}
            whileTap={!isLoading ? { scale: 0.98 } : {}}
          >
            {isLoading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <GoogleLogo weight="bold" className="h-5 w-5" />
            )}
            <span>{isLoading ? 'Signing in...' : 'Sign in with Google'}</span>
          </motion.button>
        </div>

        <p className="mt-8 text-center text-sm text-gray-500">
          By signing in, you agree to our{' '}
          <Link href="/terms" className="font-medium text-gray-900 hover:underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="font-medium text-gray-900 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </motion.div>
    </div>
  );
}
