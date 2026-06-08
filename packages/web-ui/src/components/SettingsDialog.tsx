/**
 * SettingsDialog — ChatGPT-style settings modal.
 *
 * Renders a centered card with a left sidebar (category nav) and a
 * right content pane that hosts one `SettingsClient` section at a
 * time. Replaces the standalone `/settings` page as the primary
 * entry; the route still works for direct links and falls back to
 * the legacy single-page layout.
 *
 * Data lifecycle:
 *   - Open → fetch all four lists (tokens, variables, actions,
 *     skills) via clientActions. Until they resolve, the content
 *     pane shows a small skeleton.
 *   - Close → state is dropped; next open re-fetches. Keeps the
 *     view in sync with anything created elsewhere (the marketplace
 *     installs a skill, then user opens settings — fresh data).
 *
 * Layering:
 *   - Portal to document.body (escapes the chat panel's stacking
 *     context, which has caused other floaters to be clipped).
 *   - Backdrop click + Escape key both dismiss.
 *   - The dialog itself stops mousedown propagation so the click-
 *     outside listener on the backdrop doesn't fire when clicking
 *     inside the card.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  X,
  Plug,
  Users,
  Key,
  Lock,
  PuzzlePiece,
  BookOpen,
  Terminal,
  SignOut,
  CircleNotch,
  CloudArrowUp,
} from '@phosphor-icons/react';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { Dialog } from './ui/dialog';
import SettingsClient, { type SettingsSection } from './SettingsClient';
import {
  listApiTokens,
  listVariables,
  listInstalledActions,
  listInstalledSkills,
  type ApiTokenInfo,
  type VariableInfo,
  type InstalledActionInfo,
  type InstalledSkillInfo,
} from '@clash/web-ui/lib/clientActions';

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string; weight?: 'regular' | 'bold' | 'fill' | 'duotone' }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'runtimes', label: 'Runtimes', icon: Plug },
  { id: 'sync', label: 'Sync', icon: CloudArrowUp },
  { id: 'crew', label: 'Crew', icon: Users },
  { id: 'tokens', label: 'API Tokens', icon: Key },
  { id: 'variables', label: 'Variables', icon: Lock },
  { id: 'actions', label: 'Actions', icon: PuzzlePiece },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'cli', label: 'CLI', icon: Terminal },
];

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      tokens: ApiTokenInfo[];
      variables: VariableInfo[];
      actions: InstalledActionInfo[];
      skills: InstalledSkillInfo[];
    };

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional starting section (default: runtimes). */
  initialSection?: SettingsSection;
}

export function SettingsDialog({ open, onClose, initialSection = 'runtimes' }: SettingsDialogProps) {
  const [active, setActive] = useState<SettingsSection>(initialSection);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });

  // Fetch on open — gives us up-to-date data even after other tabs
  // mutate the lists. Cancellation flag prevents a stale response
  // from clobbering state if the dialog is closed mid-flight.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    Promise.all([
      listApiTokens().catch(() => [] as ApiTokenInfo[]),
      listVariables().catch(() => [] as VariableInfo[]),
      listInstalledActions().catch(() => [] as InstalledActionInfo[]),
      listInstalledSkills().catch(() => [] as InstalledSkillInfo[]),
    ])
      .then(([tokens, variables, actions, skills]) => {
        if (cancelled) return;
        setLoad({ status: 'ready', tokens, variables, actions, skills });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape + backdrop click + focus trap are now handled by <Dialog>.

  const handleSignOut = useCallback(async () => {
    try {
      await betterAuthClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = '/';
          },
        },
      });
    } catch (err) {
      console.error('Sign out error:', err);
      window.location.href = '/';
    }
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel="Settings"
      size="xl"
      unstyled
    >
      <div className="flex h-full bg-warm-surface rounded-2xl shadow-2xl border border-warm-border overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className="w-56 shrink-0 border-r border-warm-border bg-warm-muted/40 flex flex-col">
          <div className="flex items-center justify-between px-4 py-4">
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 min-h-[36px] min-w-[36px] rounded-full flex items-center justify-center text-stone-700 hover:text-stone-900 hover:bg-warm-hover transition-colors dark:text-stone-300 dark:hover:text-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              aria-label="Close settings"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" weight="bold" aria-hidden="true" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5" aria-label="Settings sections">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                    isActive
                      ? 'bg-warm-surface text-stone-900 dark:text-stone-100 shadow-sm'
                      : 'text-stone-700 dark:text-stone-200 hover:bg-warm-surface/60 hover:text-stone-900'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-4 h-4" weight="bold" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="border-t border-warm-border p-2">
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-warm-surface hover:text-red-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <SignOut className="w-4 h-4" weight="bold" />
              Sign out
            </button>
          </div>
        </aside>

        {/* ── Content ── */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-warm-surface">
          <div className="px-8 py-6">
            <h2 className="font-display text-xl font-bold text-stone-900 dark:text-stone-100 mb-6">
              {NAV_ITEMS.find((n) => n.id === active)?.label ?? 'Settings'}
            </h2>

            {load.status === 'loading' || load.status === 'idle' ? (
              <div role="status" aria-live="polite" className="flex items-center justify-center py-20 text-stone-700 dark:text-stone-300">
                <CircleNotch className="w-6 h-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <span className="sr-only">Loading settings</span>
              </div>
            ) : load.status === 'error' ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                Failed to load settings: {load.message}
              </div>
            ) : (
              <SettingsClient
                initialTokens={load.tokens}
                initialVariables={load.variables}
                initialActions={load.actions}
                initialSkills={load.skills}
                activeSection={active}
                embedded
              />
            )}
          </div>
        </main>
      </div>
    </Dialog>
  );
}
