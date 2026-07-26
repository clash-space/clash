
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router';
import { desktopChromeMetrics } from '@clash/shared-runtime';
import type { NleAvailability } from '@master-clash/remotion-core';
import {
  ArrowLeft,
  ArrowRight,
  House,
  FolderOpen,
  SidebarSimple,
  Storefront,
  X,
} from '@phosphor-icons/react';
import UserControls from './UserControls';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { Tab, TabList, TabProvider } from './ui/tabs';
import { Tooltip } from './ui/tooltip';
import { HarnessUpdateNotifier } from './HarnessUpdateNotifier';
import {
  activateOrAppendDesktopTab,
  closeDesktopTab,
  createDesktopTab,
  DESKTOP_TAB_TITLE_EVENT,
  type DesktopTabTitleEventDetail,
  type DesktopTab,
  updateDesktopTabTitle,
} from '../lib/desktopTabs';
import {
  readProjectNavigatorCollapsed,
  setProjectNavigatorCollapsedFromChrome,
} from '../lib/projectNavigatorChrome';

declare global {
  var __CLASH_DESKTOP__:
    | {
        isDesktop: true;
        newWindow: () => Promise<{ windowId: number; windowCount: number }>;
        getNleAvailability?: () => Promise<NleAvailability[]>;
        exportDirectorVideo?: (request: unknown) => Promise<{ canceled: boolean; outputPath?: string }>;
        openInNle?: (request: unknown) => Promise<{ documentPath: string }>;
      }
    | undefined;
}

const navItems = [
  { name: 'Home', href: '/', icon: House },
  { name: 'Projects', href: '/projects', icon: FolderOpen },
  { name: 'Store', href: '/marketplace/manage', icon: Storefront },
];

const desktopChromeStyle = {
  '--clash-desktop-chrome-height': `${desktopChromeMetrics.tabStripHeight}px`,
  '--clash-desktop-toolbar-left-inset': `${desktopChromeMetrics.toolbarLeftInset}px`,
} as CSSProperties;

const HOME_DESKTOP_TAB_ID = 'tab-home';

function ensureHomeDesktopTab(tabs: DesktopTab[]): DesktopTab[] {
  const homeTab = tabs.find((tab) => tab.path === '/');
  const remainingTabs = tabs.filter((tab) => tab.path !== '/');
  return [homeTab ?? createDesktopTab('/', HOME_DESKTOP_TAB_ID), ...remainingTabs];
}

export default function TopNavigation() {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const isProjectDetailPage = /^\/projects\/[^/]+$/.test(pathname);
  const isSettingsPage = pathname === '/settings';
  const [isDesktop, setIsDesktop] = useState(false);
  const [desktopTabs, setDesktopTabs] = useState<DesktopTab[]>([]);
  const [activeDesktopTabId, setActiveDesktopTabId] = useState<string | null>(null);
  const [projectNavigatorCollapsed, setProjectNavigatorCollapsed] = useState(false);
  const [desktopHistory, setDesktopHistory] = useState<{ entries: string[]; index: number }>(() => ({
    entries: [pathname],
    index: 0,
  }));
  const pendingDesktopHistoryPathRef = useRef<string | null>(null);

  useEffect(() => {
    const desktop = globalThis.__CLASH_DESKTOP__?.isDesktop === true;
    setIsDesktop(desktop);

    if (desktop) {
      setDesktopHistory({ entries: [pathname], index: 0 });
      const initial = activateOrAppendDesktopTab(
        ensureHomeDesktopTab([]),
        pathname,
        `tab-${Date.now().toString(36)}`,
      );
      setDesktopTabs(ensureHomeDesktopTab(initial.tabs));
      setActiveDesktopTabId(initial.activeTabId);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    setDesktopHistory((history) => {
      const pendingPath = pendingDesktopHistoryPathRef.current;
      if (pendingPath === pathname) {
        pendingDesktopHistoryPathRef.current = null;
        return history;
      }

      const currentPath = history.entries[history.index];
      if (currentPath === pathname) return history;

      const previousEntries = history.entries.slice(0, history.index + 1);
      return {
        entries: [...previousEntries, pathname],
        index: previousEntries.length,
      };
    });
  }, [isDesktop, pathname]);

  useEffect(() => {
    setProjectNavigatorCollapsed(
      isProjectDetailPage ? readProjectNavigatorCollapsed() : false,
    );
  }, [isProjectDetailPage, pathname]);

  useEffect(() => {
    if (!isDesktop) return;
    const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setDesktopTabs((tabs) => {
      const next = activateOrAppendDesktopTab(ensureHomeDesktopTab(tabs), pathname, id);
      setActiveDesktopTabId(next.activeTabId);
      return ensureHomeDesktopTab(next.tabs);
    });
  }, [isDesktop, pathname]);

  useEffect(() => {
    if (!isDesktop) return;

    const handleDesktopTabTitle = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTabTitleEventDetail>).detail;
      if (!detail || typeof detail.path !== 'string' || typeof detail.title !== 'string') return;
      setDesktopTabs((tabs) => updateDesktopTabTitle(tabs, detail.path, detail.title));
    };

    window.addEventListener(DESKTOP_TAB_TITLE_EVENT, handleDesktopTabTitle);
    return () => window.removeEventListener(DESKTOP_TAB_TITLE_EVENT, handleDesktopTabTitle);
  }, [isDesktop]);

  const openPathInDesktopTab = (path: string) => {
    const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setDesktopTabs((tabs) => {
      const next = activateOrAppendDesktopTab(ensureHomeDesktopTab(tabs), path, id);
      setActiveDesktopTabId(next.activeTabId);
      return ensureHomeDesktopTab(next.tabs);
    });
    if (pathname !== path) navigate(path);
  };

  const selectDesktopTab = (tab: DesktopTab) => {
    setActiveDesktopTabId(tab.id);
    if (tab.path !== pathname) navigate(tab.path);
  };

  const selectDesktopTabId = (tabId: string | null | undefined) => {
    const tab = desktopTabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    selectDesktopTab(tab);
  };

  const closeTab = (tabId: string) => {
    const tabToClose = desktopTabs.find((tab) => tab.id === tabId);
    if (!tabToClose || tabToClose.path === '/') return;

    if (!activeDesktopTabId) {
      setDesktopTabs((tabs) => ensureHomeDesktopTab(tabs.filter((tab) => tab.id !== tabId)));
      return;
    }

    const result = closeDesktopTab(
      ensureHomeDesktopTab(desktopTabs),
      activeDesktopTabId,
      tabId,
      HOME_DESKTOP_TAB_ID,
    );
    const nextTabs = ensureHomeDesktopTab(result.tabs);
    const nextActiveTab = nextTabs.find((tab) => tab.id === result.activeTabId) ?? nextTabs[0];
    setDesktopTabs(nextTabs);
    setActiveDesktopTabId(nextActiveTab.id);
    if (nextActiveTab.path !== pathname) navigate(nextActiveTab.path);
  };
  const canGoBack = desktopHistory.index > 0;
  const canGoForward = desktopHistory.index < desktopHistory.entries.length - 1;
  const navigateDesktopHistory = (delta: -1 | 1) => {
    const nextIndex = desktopHistory.index + delta;
    if (nextIndex < 0 || nextIndex >= desktopHistory.entries.length) return;
    const nextPath = desktopHistory.entries[nextIndex];
    pendingDesktopHistoryPathRef.current = nextPath;
    setDesktopHistory((history) => ({ ...history, index: nextIndex }));
    if (nextPath !== pathname) navigate(nextPath);
  };
  const toggleProjectNavigator = () => {
    const collapsed = !projectNavigatorCollapsed;
    setProjectNavigatorCollapsed(collapsed);
    setProjectNavigatorCollapsedFromChrome(collapsed);
  };

  if (isDesktop) {
    return (
      <>
        <header
          data-desktop-chrome="true"
          style={desktopChromeStyle}
          className="desktop-drag-region fixed left-0 right-0 top-0 z-50 h-[var(--clash-desktop-chrome-height)] border-b border-warm-border bg-warm-muted/95 text-slate-900 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_10px_28px_rgba(35,31,25,0.065)] backdrop-blur-xl dark:text-slate-100 dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_28px_rgba(0,0,0,0.28)]"
        >
          <div
            data-desktop-toolbar="true"
            className="flex h-full items-center gap-[var(--clash-control-gap)] pl-[max(var(--clash-desktop-toolbar-left-inset),env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
          >
            {isProjectDetailPage ? (
              <Tooltip
                label={
                  projectNavigatorCollapsed
                    ? 'Expand project sidebar'
                    : 'Collapse project sidebar'
                }
              >
                <IconButton
                  data-project-navigator-toggle
                  label={
                    projectNavigatorCollapsed
                      ? 'Expand project sidebar'
                      : 'Collapse project sidebar'
                  }
                  icon={<SidebarSimple className="h-4 w-4" weight="regular" />}
                  size="sm"
                  onClick={toggleProjectNavigator}
                  className="desktop-no-drag flex-none text-stone-700 hover:bg-black/[0.055] hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/[0.07] dark:hover:text-stone-50"
                />
              </Tooltip>
            ) : null}
            <Tooltip label="Back">
              <IconButton
                label="Back"
                icon={<ArrowLeft className="h-4 w-4" />}
                size="sm"
                onClick={() => navigateDesktopHistory(-1)}
                disabled={!canGoBack}
                className="desktop-no-drag flex-none text-stone-700 hover:bg-black/[0.055] disabled:cursor-default disabled:text-stone-300 disabled:hover:bg-transparent dark:text-stone-300 dark:hover:bg-white/[0.07] dark:hover:text-stone-50 dark:disabled:text-stone-600"
              />
            </Tooltip>
            <Tooltip label="Forward">
              <IconButton
                label="Forward"
                icon={<ArrowRight className="h-4 w-4" />}
                size="sm"
                onClick={() => navigateDesktopHistory(1)}
                disabled={!canGoForward}
                className="desktop-no-drag flex-none text-stone-700 hover:bg-black/[0.055] disabled:cursor-default disabled:text-stone-300 disabled:hover:bg-transparent dark:text-stone-300 dark:hover:bg-white/[0.07] dark:hover:text-stone-50 dark:disabled:text-stone-600"
              />
            </Tooltip>
            <TabProvider
              selectedId={activeDesktopTabId ?? undefined}
              setSelectedId={selectDesktopTabId}
              focusLoop
            >
              <TabList
                aria-label="Open tabs"
                className="desktop-drag-region flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
              >
                {desktopTabs.map((tab, index) => {
                  const active = tab.id === activeDesktopTabId;
                  const isHomeTab = tab.path === '/';
                  const nextTab = desktopTabs[index + 1];
                  const nextActive = nextTab?.id === activeDesktopTabId;
                  const showInactiveSeparator = !active && !!nextTab && !nextActive;
                  return (
                    <div
                      key={tab.id}
                      data-desktop-tab="true"
                      className={`desktop-no-drag group relative flex h-8 items-center gap-1 rounded-lg border text-[13px] font-medium transition-colors ${
                        isHomeTab ? 'w-10 flex-none justify-center px-0' : 'min-w-36 max-w-60 px-2.5'
                      } ${
                        active
                          ? 'border-warm-border bg-warm-surface text-slate-950 shadow-sm dark:text-slate-50'
                          : 'border-transparent bg-transparent text-stone-600 hover:bg-warm-surface/65 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100'
                      }`}
                    >
                      <Tab
                        id={tab.id}
                        aria-label={isHomeTab ? 'Home' : undefined}
                        className={`min-w-0 focus-visible:outline-none ${
                          isHomeTab ? 'inline-flex h-full w-full items-center justify-center' : 'flex-1 truncate text-left'
                        }`}
                      >
                        {isHomeTab ? (
                          <House
                            className={`h-4 w-4 ${active ? 'text-brand' : ''}`}
                            weight={active ? 'fill' : 'regular'}
                            aria-hidden="true"
                          />
                        ) : (
                          tab.title
                        )}
                      </Tab>
                      {!isHomeTab && (
                        <Tooltip label={`Close ${tab.title}`}>
                          <IconButton
                            label={`Close ${tab.title}`}
                            icon={<X className="h-3 w-3" weight="bold" />}
                            size="sm"
                            shape="circle"
                            onClick={() => closeTab(tab.id)}
                            className={`flex-none ${
                              active
                                ? 'text-stone-500 hover:bg-black/10 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-50'
                                : 'text-stone-400 opacity-0 hover:bg-black/10 hover:text-stone-800 group-hover:opacity-100 dark:text-stone-500 dark:hover:bg-white/10 dark:hover:text-stone-100'
                            }`}
                          />
                        </Tooltip>
                      )}
                      {showInactiveSeparator && (
                        <span
                          aria-hidden="true"
                          data-desktop-tab-separator="true"
                          className="pointer-events-none absolute right-0 top-1/2 h-5 w-px -translate-y-1/2 bg-warm-border/90"
                        />
                      )}
                    </div>
                  );
                })}
              </TabList>
            </TabProvider>
            <HarnessUpdateNotifier />
          </div>
        </header>

        {!isProjectDetailPage && !isSettingsPage && (
          <div
            style={desktopChromeStyle}
            className="pointer-events-none fixed left-0 right-0 top-[calc(var(--clash-desktop-chrome-height)+0.5rem)] z-40 pb-5"
          >
            <div className="relative flex w-full items-center justify-between pr-[max(2rem,env(safe-area-inset-right))] pl-[max(2rem,env(safe-area-inset-left))] md:px-12">
              <div className="desktop-no-drag pointer-events-auto z-10">
                <IconButton
                  onClick={() => openPathInDesktopTab('/')}
                  label="Clash home"
                  size="lg"
                  className="group h-12 min-h-12 w-12 min-w-12 bg-transparent p-0 text-current shadow-none hover:bg-transparent"
                  icon={
                    <span className="relative block h-11 w-11 transition-transform duration-150 group-hover:scale-105">
                      <img
                        src="/brand/logo-c.svg"
                        alt=""
                        className="h-11 w-11 object-contain dark:hidden"
                        draggable={false}
                      />
                      <img
                        src="/brand/logo-c.svg"
                        alt=""
                        className="hidden h-11 w-11 object-contain dark:block"
                        draggable={false}
                      />
                    </span>
                  }
                />
              </div>

              <nav aria-label="Primary" className="desktop-no-drag pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-2xl border border-warm-border bg-warm-surface px-2 py-2 shadow-md">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Button
                      key={item.name}
                      size="sm"
                      onClick={() => openPathInDesktopTab(item.href)}
                      aria-label={item.name}
                      aria-current={isActive ? 'page' : undefined}
                      className={`relative flex min-h-0 items-center gap-2.5 rounded-xl border-transparent bg-transparent px-5 py-2.5 text-base font-display font-medium shadow-none transition-colors hover:bg-transparent ${
                        isActive
                          ? 'text-slate-900 dark:text-slate-50'
                          : 'text-slate-700 hover:bg-warm-muted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="desktop-nav-pill"
                          className="absolute inset-0 rounded-xl bg-warm-muted"
                          transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-2.5">
                        <Icon className={`h-5 w-5 ${isActive ? 'text-brand' : ''}`} weight={isActive ? 'fill' : 'regular'} />
                        {item.name}
                      </span>
                    </Button>
                  );
                })}
              </nav>

              <div className="desktop-no-drag pointer-events-auto z-10 flex items-center gap-3">
                <UserControls />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <header
      className="pointer-events-none fixed top-0 left-0 right-0 z-50 pb-5 pt-[max(1.5rem,env(safe-area-inset-top))]"
    >
      <div
        className="relative flex items-center justify-between w-full pr-[max(2rem,env(safe-area-inset-right))] pl-[max(2rem,env(safe-area-inset-left))] md:px-12"
      >
        {/* Logo Area */}
        <div className="desktop-no-drag pointer-events-auto z-10">
          <Link to="/" className="group flex h-12 w-12 items-center justify-center" aria-label="Clash home">
            <span className="relative block h-11 w-11 transition-transform duration-150 group-hover:scale-105">
              <img
                src="/brand/logo-c.svg"
                alt=""
                className="h-11 w-11 object-contain dark:hidden"
                draggable={false}
              />
              <img
                src="/brand/logo-c.svg"
                alt=""
                className="hidden h-11 w-11 object-contain dark:block"
                draggable={false}
              />
            </span>
          </Link>
        </div>

        {/* Floating Center Nav */}
        <nav aria-label="Primary" className="desktop-no-drag pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-md border border-warm-border bg-warm-surface rounded-2xl px-2 py-2 flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.name} to={item.href} aria-current={isActive ? 'page' : undefined}>
                <div
                  className={`relative flex items-center gap-2.5 rounded-xl px-5 py-2.5 text-base font-display font-medium transition-colors ${
                    isActive
                      ? 'text-slate-900 dark:text-slate-50'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-warm-muted dark:text-slate-300 dark:hover:text-slate-100'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-warm-muted rounded-xl"
                      transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2.5">
                    <Icon className={`h-5 w-5 ${isActive ? 'text-brand' : ''}`} weight={isActive ? 'fill' : 'regular'} />
                    {item.name}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="desktop-no-drag pointer-events-auto flex items-center gap-3 z-10">
          <UserControls />
        </div>
      </div>
    </header>
  );
}
