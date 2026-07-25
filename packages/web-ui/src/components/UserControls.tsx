
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { GoogleLogo, Gear, SignOut, CreditCard, Lightning } from '@phosphor-icons/react';
import { Link } from 'react-router';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { useBillingBalance } from '@clash/web-ui/hooks/useBillingBalance';
import { getRuntimeConfig } from '@clash/web-ui/lib/runtimeConfig';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Tooltip } from './ui/tooltip';

interface UserControlsProps {
  compact?: boolean;
  projectChrome?: boolean;
}

function localLoginUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.protocol !== 'http:') return null;
  if (window.location.hostname !== '127.0.0.1' && window.location.hostname !== '::1') return null;
  return `http://localhost:${window.location.port || '80'}/login`;
}

function SettingsOnlyControl({ compact = false, projectChrome = false }: UserControlsProps) {
  return (
    <Tooltip label="Settings">
      <Link
        to="/settings"
        aria-label="Settings"
        className={
          projectChrome
            ? 'clash-project-top-action inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-900 transition-colors hover:bg-black/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page'
            : compact
            ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-warm-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
            : 'inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-warm-border bg-warm-surface text-stone-800 shadow-sm transition-all hover:border-brand/35 hover:bg-warm-muted hover:text-slate-950 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page'
        }
      >
        <Gear className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

function AccountUserControls({ compact = false, projectChrome = false }: UserControlsProps = {}) {
  const sessionQuery = betterAuthClient.useSession();
  const session = sessionQuery.data;
  const user = session?.user;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const balance = useBillingBalance(!!user);

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
      const canonical = localLoginUrl();
      if (canonical) {
        window.location.href = canonical;
        return;
      }
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
    <div className={`flex items-center ${compact || projectChrome ? 'gap-1.5' : 'gap-3'}`}>
      {user ? (
        <div className="relative flex items-center gap-2">
          {(balance.status === 'ready' || balance.status === 'loading') && (
            <Tooltip
              label={
                balance.status === 'ready'
                  ? `${balance.balance.available.toLocaleString()} credits`
                  : 'Credits balance'
              }
            >
              <Link
                to="/billing"
                className={
                  projectChrome
                    ? 'clash-project-top-balance flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-display font-semibold text-slate-900 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page'
                    : compact
                    ? 'flex h-8 w-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-200/70 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
                    : 'flex items-center gap-1.5 rounded-xl bg-warm-surface border border-warm-border px-3 py-1.5 shadow-sm hover:shadow-md hover:border-brand/40 transition-all text-sm font-display font-medium text-stone-800 dark:text-stone-200'
                }
                aria-label="Credits balance — click to manage billing"
              >
                <Lightning weight="fill" className="h-3.5 w-3.5 text-brand" />
                {(!compact || projectChrome) && (
                  balance.status === 'ready' ? (
                    <span className="tabular-nums">{balance.balance.available.toLocaleString()}</span>
                  ) : (
                    <span className="inline-block h-3 w-8 rounded bg-warm-muted animate-pulse" />
                  )
                )}
              </Link>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                aria-label={`Account menu — ${user.name}`}
                className={
                  projectChrome
                    ? 'clash-project-top-avatar flex h-10 min-h-0 w-10 items-center justify-center rounded-xl border-transparent bg-transparent p-0 shadow-none transition-all focus-visible:ring-offset-warm-page'
                    : compact
                    ? 'flex h-8 min-h-0 items-center rounded-lg border-transparent bg-transparent px-1 text-stone-700 shadow-none transition-colors hover:bg-stone-200/70 hover:text-stone-950'
                    : 'flex min-h-0 items-center gap-3 rounded-2xl border border-warm-border bg-warm-surface pl-1.5 pr-4 py-1.5 text-sm shadow-sm cursor-pointer hover:shadow-md transition-shadow focus-visible:ring-offset-warm-page'
                }
              >
                {user.image && !avatarFailed ? (
                  <img
                    src={user.image}
                    alt=""
                    className={`${compact ? 'h-7 w-7' : projectChrome ? 'h-8 w-8' : 'h-10 w-10'} rounded-xl object-cover`}
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <div className={`flex ${compact ? 'h-7 w-7 text-[11px]' : projectChrome ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'} items-center justify-center rounded-xl bg-brand-light font-bold text-slate-950 ring-1 ring-brand/20 dark:bg-brand/20 dark:text-slate-50`} aria-hidden="true">
                    {getInitials(user.name)}
                  </div>
                )}
                {!compact && !projectChrome && (
                  <span className="text-base font-display font-medium text-stone-800 dark:text-stone-200 max-w-[120px] truncate">
                    {user.name}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent aria-label="Account" align="end" side="bottom" className="w-[208px]">
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Gear className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-medium">Settings</span>
                </Link>
              </DropdownMenuItem>
              {balance.status !== 'unavailable' && (
                <DropdownMenuItem asChild>
                  <Link to="/billing">
                    <CreditCard className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium">Billing</span>
                    {balance.status === 'ready' && (
                      <span className="text-xs tabular-nums text-stone-600 dark:text-stone-300">
                        {balance.balance.available.toLocaleString()}
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void handleSignOut();
                }}
              >
                <SignOut className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium">Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <Button
          onClick={handleSignIn}
          className={
            projectChrome
              ? 'clash-project-top-action flex h-10 min-h-0 items-center gap-1.5 rounded-xl border-transparent bg-transparent px-3 text-sm font-display font-semibold text-slate-900 shadow-none focus-visible:ring-offset-warm-page'
              : compact
              ? 'clash-user-primary flex h-8 min-h-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium'
              : 'clash-user-primary flex items-center gap-2 rounded-xl px-6 py-3 text-base font-display font-medium focus-visible:ring-offset-warm-page'
          }
        >
          <GoogleLogo weight="bold" className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
          {compact || projectChrome ? 'Sign in' : 'Sign in with Google'}
        </Button>
      )}
    </div>
  );
}

export default function UserControls(props: UserControlsProps = {}) {
  if (getRuntimeConfig().mode === 'desktop') {
    return <SettingsOnlyControl {...props} />;
  }

  return <AccountUserControls {...props} />;
}
