import { useCallback, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  X,
  Plug,
  Key,
  PuzzlePiece,
  BookOpen,
  Terminal,
  SignOut,
  CloudArrowUp,
  Microphone,
} from '@phosphor-icons/react';
import betterAuthClient from '@clash/web-ui/lib/betterAuthClient';
import { getRuntimeConfig } from '@clash/web-ui/lib/runtimeConfig';
import SettingsClient, { type SettingsSection } from './SettingsClient';
import { Tooltip } from './ui/tooltip';
import { IconButton } from './ui/icon-button';
import { Button } from './ui/button';
import { Tab, TabList, TabProvider } from './ui/tabs';
import {
  listApiTokens,
  listVariables,
  listInstalledActions,
  listInstalledSkills,
  listModelProviders,
  listModelCatalog,
  type ApiTokenInfo,
  type VariableInfo,
  type InstalledActionInfo,
  type InstalledSkillInfo,
  type ModelProviderAccountInfo,
  type ModelCatalogEntryInfo,
} from '@clash/web-ui/lib/clientActions';

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string; weight?: 'regular' | 'bold' | 'fill' | 'duotone' }>;
}

export const SETTINGS_NAV_ITEMS: NavItem[] = [
  { id: 'agents', label: 'Agents', icon: Plug },
  { id: 'sync', label: 'Sync', icon: CloudArrowUp },
  { id: 'audio', label: 'Audio', icon: Microphone },
  { id: 'tokens', label: 'API Tokens', icon: Key },
  { id: 'providers', label: 'Providers', icon: Plug },
  { id: 'models', label: 'Models', icon: Plug },
  { id: 'actions', label: 'Actions', icon: PuzzlePiece },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'cli', label: 'CLI', icon: Terminal },
];

const HOSTED_ONLY_SETTINGS_SECTIONS = new Set<SettingsSection>(['tokens', 'variables']);

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
      modelProviders: ModelProviderAccountInfo[];
      modelCatalog: ModelCatalogEntryInfo[];
    };

export interface SettingsSurfaceProps {
  active: SettingsSection;
  onActiveChange: (section: SettingsSection) => void;
  onClose?: () => void;
  variant?: 'dialog' | 'page';
}

export function isSettingsSection(value: string | null | undefined): value is SettingsSection {
  return Boolean(value && SETTINGS_NAV_ITEMS.some((item) => item.id === value));
}

export const SETTINGS_SECTION_STORAGE_KEY = 'clash.settings.activeSection';

export function readLastSettingsSection(): SettingsSection | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(SETTINGS_SECTION_STORAGE_KEY);
    return isSettingsSection(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastSettingsSection(section: SettingsSection): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, section);
  } catch {
    // Local storage can be blocked in private or embedded contexts.
  }
}

function supportsRemoteWorkerVariables(): boolean {
  return getRuntimeConfig().mode === 'hosted';
}

function supportsHostedSettings(): boolean {
  return getRuntimeConfig().mode === 'hosted';
}

function availableSettingsNavItems(hostedSettingsAvailable: boolean): NavItem[] {
  if (hostedSettingsAvailable) return SETTINGS_NAV_ITEMS;
  return SETTINGS_NAV_ITEMS.filter((item) => !HOSTED_ONLY_SETTINGS_SECTIONS.has(item.id));
}

function effectiveSettingsSection(section: SettingsSection, hostedSettingsAvailable: boolean): SettingsSection {
  if (!hostedSettingsAvailable && HOSTED_ONLY_SETTINGS_SECTIONS.has(section)) return 'agents';
  return section;
}

function SettingsSurfaceSkeletonLine({ className = '' }: { className?: string }) {
  return (
    <span
      className={`block rounded-full bg-warm-muted ${className}`}
    />
  );
}

function SettingsSurfaceLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading settings" aria-live="polite" className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <div key={index} className="rounded-xl border border-warm-border bg-warm-surface p-4">
            <SettingsSurfaceSkeletonLine className="h-3 w-24" />
            <SettingsSurfaceSkeletonLine className="mt-2 h-2.5 w-36" />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-warm-border bg-warm-surface p-4">
        <SettingsSurfaceSkeletonLine className="h-2.5 w-32" />
        <SettingsSurfaceSkeletonLine className="h-9 w-full rounded-lg" />
        <SettingsSurfaceSkeletonLine className="h-2.5 w-28" />
        <SettingsSurfaceSkeletonLine className="h-9 w-full rounded-lg" />
        <div className="flex gap-2 pt-1">
          <SettingsSurfaceSkeletonLine className="h-2.5 w-20" />
          <SettingsSurfaceSkeletonLine className="h-2.5 w-16" />
        </div>
      </div>
    </div>
  );
}

export function SettingsSurface({
  active,
  onActiveChange,
  onClose,
  variant = 'dialog',
}: SettingsSurfaceProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const isPage = variant === 'page';
  const hostedSettingsAvailable = supportsHostedSettings();
  const remoteWorkerVariablesAvailable = supportsRemoteWorkerVariables();
  const navItems = availableSettingsNavItems(hostedSettingsAvailable);
  const activeSection = effectiveSettingsSection(active, hostedSettingsAvailable);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    Promise.all([
      hostedSettingsAvailable
        ? listApiTokens().catch(() => [] as ApiTokenInfo[])
        : Promise.resolve([] as ApiTokenInfo[]),
      remoteWorkerVariablesAvailable
        ? listVariables().catch(() => [] as VariableInfo[])
        : Promise.resolve([] as VariableInfo[]),
      listInstalledActions().catch(() => [] as InstalledActionInfo[]),
      listInstalledSkills().catch(() => [] as InstalledSkillInfo[]),
      listModelProviders().catch(() => [] as ModelProviderAccountInfo[]),
      listModelCatalog().catch(() => [] as ModelCatalogEntryInfo[]),
    ])
      .then(([tokens, variables, actions, skills, modelProviders, modelCatalog]) => {
        if (cancelled) return;
        setLoad({ status: 'ready', tokens, variables, actions, skills, modelProviders, modelCatalog });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [hostedSettingsAvailable, remoteWorkerVariablesAvailable]);

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
    <div
      className={
        isPage
          ? 'clash-settings-page-shell flex h-full min-h-full w-full overflow-hidden'
          : 'clash-settings-dialog-shell flex h-full overflow-hidden rounded-2xl'
      }
    >
      <aside className={`${isPage ? 'clash-settings-page-sidebar' : 'clash-settings-dialog-sidebar'} flex w-64 shrink-0 flex-col border-r border-warm-border/75`}>
        <div className="flex items-center justify-between px-4 py-4">
          {onClose ? (
            <Tooltip label="Close settings">
              <IconButton
                label="Close settings"
                icon={<X className="h-4 w-4" weight="bold" />}
                shape="circle"
                size="md"
                onClick={onClose}
                className="text-stone-700 hover:bg-warm-hover hover:text-stone-900 focus-visible:ring-brand/60 dark:text-stone-300 dark:hover:text-stone-100"
              />
            </Tooltip>
          ) : (
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Settings
              </h1>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">Workspace controls</p>
            </div>
          )}
        </div>
        <TabProvider
          selectedId={activeSection}
          setSelectedId={(section) => {
            if (isSettingsSection(section)) onActiveChange(section);
          }}
          orientation="vertical"
          focusLoop
        >
          <TabList className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1" aria-label="Settings sections">
            {navItems.map((item) => {
              const isActive = activeSection === item.id;
              const Icon = item.icon;
              return (
                <Tab
                  key={item.id}
                  id={item.id}
                  className={`relative flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
                    isActive
                      ? 'border-brand/35 bg-brand-light text-brand shadow-sm dark:border-brand/30 dark:bg-brand/10 dark:text-brand-light'
                      : 'border-transparent text-stone-700 hover:bg-warm-surface/60 hover:text-stone-900 dark:text-stone-200'
                  }`}
                >
                  {isActive && (
                    <span aria-hidden="true" className="absolute left-1.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand" />
                  )}
                  <Icon className={`h-4 w-4 ${isActive ? 'text-brand' : ''}`} weight="bold" />
                  <span className="truncate">{item.label}</span>
                </Tab>
              );
            })}
          </TabList>
        </TabProvider>
        <div className="border-t border-warm-border p-2">
          <Button
            onClick={handleSignOut}
            size="sm"
            className="w-full justify-start rounded-lg border-transparent bg-transparent px-3 py-2 text-sm text-stone-700 shadow-none hover:bg-warm-surface hover:text-red-600 focus-visible:ring-brand/60 dark:text-stone-200"
            leftIcon={<SignOut className="h-4 w-4" weight="bold" />}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <main className={`${isPage ? 'clash-settings-page-content' : 'clash-settings-dialog-content'} min-w-0 flex-1 overflow-y-auto`}>
        <div className={isPage ? 'mx-auto w-full max-w-6xl px-10 py-10 xl:px-14' : 'px-8 py-6'}>
          <h2 className="mb-6 font-display text-xl font-bold text-stone-900 dark:text-stone-100">
            {navItems.find((item) => item.id === activeSection)?.label ?? 'Settings'}
          </h2>

          {load.status === 'loading' || load.status === 'idle' ? (
            <SettingsSurfaceLoadingSkeleton />
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
              initialModelProviders={load.modelProviders}
              initialModelCatalog={load.modelCatalog}
              activeSection={activeSection}
              embedded
            />
          )}
        </div>
      </main>
    </div>
  );
}
