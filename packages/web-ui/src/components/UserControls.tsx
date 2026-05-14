
/* eslint-disable @next/next/no-img-element */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleLogo, Gear, SignOut, CreditCard, Lightning } from '@phosphor-icons/react';
import { Link } from 'react-router';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { useBillingBalance } from '@clash/web-ui/hooks/useBillingBalance';

export default function UserControls() {
  const sessionQuery = betterAuthClient.useSession();
  const session = sessionQuery.data;
  const user = session?.user;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const balance = useBillingBalance(!!user);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSignOut = async () => {
    try {
      await betterAuthClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = '/';
          },
        },
      });
    } catch (error) {
      console.error('Sign out error:', error);
      window.location.href = '/';
    }
  };

  const handleSignIn = async () => {
    try {
      await betterAuthClient.signIn.social({
        provider: 'google',
        callbackURL: '/',
      });
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const getInitials = (name: string | null | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className="flex items-center gap-3">
      {user ? (
        <div className="relative flex items-center gap-2" ref={menuRef}>
          {(balance.status === 'ready' || balance.status === 'loading') && (
            <Link
              to="/billing"
              className="flex items-center gap-1.5 rounded-full bg-warm-surface border border-warm-border px-3 py-1.5 shadow-sm hover:shadow-md hover:border-brand/40 transition-all text-sm font-display font-medium text-stone-700"
              aria-label="Credits balance — click to manage billing"
              title="Credits balance"
            >
              <Lightning weight="fill" className="h-3.5 w-3.5 text-brand" />
              {balance.status === 'ready' ? (
                <span className="tabular-nums">{balance.balance.available.toLocaleString()}</span>
              ) : (
                <span className="inline-block h-3 w-8 rounded bg-warm-muted animate-pulse" />
              )}
            </Link>
          )}
          <motion.div
            className="flex items-center gap-3 rounded-full bg-warm-surface border border-warm-border pl-1.5 pr-4 py-1.5 shadow-sm cursor-pointer hover:shadow-md transition-all"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setOpen(prev => !prev)}
          >
            {user.image ? (
              <img
                src={user.image}
                alt="Avatar"
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand to-red-500 text-sm font-bold text-white">
                {getInitials(user.name)}
              </div>
            )}
            <span className="text-base font-display font-medium text-stone-700 max-w-[120px] truncate">
              {user.name}
            </span>
          </motion.div>

          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-48 rounded-xl bg-warm-surface border border-warm-border shadow-lg py-1.5 z-50"
              >
                <Link
                  to="/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-warm-muted transition-colors"
                >
                  <Gear className="h-4 w-4" />
                  Settings
                </Link>
                {balance.status !== 'unavailable' && (
                  <Link
                    to="/billing"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-warm-muted transition-colors"
                  >
                    <span className="flex items-center gap-2.5">
                      <CreditCard className="h-4 w-4" />
                      Billing
                    </span>
                    {balance.status === 'ready' && (
                      <span className="text-xs tabular-nums text-stone-500">
                        {balance.balance.available.toLocaleString()}
                      </span>
                    )}
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-warm-muted transition-colors"
                >
                  <SignOut className="h-4 w-4" />
                  Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <motion.button
          onClick={handleSignIn}
          className="flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-base font-display font-medium text-white transition-all hover:bg-slate-800 shadow-lg shadow-slate-950/20"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <GoogleLogo weight="bold" className="h-5 w-5" />
          Sign in with Google
        </motion.button>
      )}
    </div>
  );
}
