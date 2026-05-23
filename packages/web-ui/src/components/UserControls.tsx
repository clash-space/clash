
/* eslint-disable @next/next/no-img-element */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleLogo, Gear, SignOut, CreditCard, Lightning } from '@phosphor-icons/react';
import { Link } from 'react-router';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { useBillingBalance } from '@clash/web-ui/hooks/useBillingBalance';
import { SettingsDialog } from './SettingsDialog';

export default function UserControls() {
  const sessionQuery = betterAuthClient.useSession();
  const session = sessionQuery.data;
  const user = session?.user;
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
              className="flex items-center gap-1.5 rounded-full bg-warm-surface border border-warm-border px-3 py-1.5 shadow-sm hover:shadow-md hover:border-brand/40 transition-all text-sm font-display font-medium text-stone-800 dark:text-stone-200"
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
          <button
            type="button"
            onClick={() => setOpen(prev => !prev)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Account menu — ${user.name}`}
            className="flex items-center gap-3 rounded-full bg-warm-surface border border-warm-border pl-1.5 pr-4 py-1.5 shadow-sm cursor-pointer hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
          >
            {user.image ? (
              <img
                src={user.image}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand to-red-500 text-sm font-bold text-white" aria-hidden="true">
                {getInitials(user.name)}
              </div>
            )}
            <span className="text-base font-display font-medium text-stone-800 dark:text-stone-200 max-w-[120px] truncate">
              {user.name}
            </span>
          </button>

          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                /* top-full anchors the dropdown's top edge to the
                   parent's bottom edge — `mt-2` alone on an absolute
                   child collapses to top:0 + margin, which made the
                   menu overlap the avatar pill. */
                className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-warm-surface border border-warm-border shadow-lg py-1.5 z-50"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setSettingsOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-stone-800 dark:text-stone-200 hover:bg-warm-muted transition-colors text-left"
                >
                  <Gear className="h-4 w-4" />
                  Settings
                </button>
                {balance.status !== 'unavailable' && (
                  <Link
                    to="/billing"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-4 py-2.5 text-sm font-medium text-stone-800 dark:text-stone-200 hover:bg-warm-muted transition-colors"
                  >
                    <span className="flex items-center gap-2.5">
                      <CreditCard className="h-4 w-4" />
                      Billing
                    </span>
                    {balance.status === 'ready' && (
                      <span className="text-xs tabular-nums text-stone-700 dark:text-stone-300">
                        {balance.balance.available.toLocaleString()}
                      </span>
                    )}
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-stone-800 dark:text-stone-200 hover:bg-warm-muted transition-colors"
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
          type="button"
          onClick={handleSignIn}
          className="flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 min-h-[44px] text-base font-display font-medium text-white transition-all hover:bg-slate-800 shadow-lg shadow-slate-950/20 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <GoogleLogo weight="bold" className="h-5 w-5" aria-hidden="true" />
          Sign in with Google
        </motion.button>
      )}
      {/* Same modal as the project page's avatar uses — Settings opens
          as a centered overlay instead of a route nav, so the user
          doesn't lose the current page (Home, Projects list, etc.). */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
