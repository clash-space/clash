
import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router';
import { desktopChromeMetrics } from '@clash/shared-runtime';
import {
  House,
  FolderOpen,
  Storefront,
  X,
} from '@phosphor-icons/react';
import UserControls from './UserControls';
import {
  activateOrAppendDesktopTab,
  appendDesktopTab,
  closeDesktopTab,
  DESKTOP_TAB_TITLE_EVENT,
  type DesktopTabTitleEventDetail,
  type DesktopTab,
  updateDesktopTabTitle,
} from '../lib/desktopTabs';

declare global {
  var __CLASH_DESKTOP__:
    | {
        isDesktop: true;
        newWindow: () => Promise<{ windowId: number; windowCount: number }>;
      }
    | undefined;
}

const navItems = [
  { name: 'Home', href: '/', icon: House },
  { name: 'Projects', href: '/projects', icon: FolderOpen },
  { name: 'Store', href: '/marketplace', icon: Storefront },
];

const desktopChromeStyle = {
  '--clash-desktop-chrome-height': `${desktopChromeMetrics.tabStripHeight}px`,
  '--clash-desktop-toolbar-left-inset': `${desktopChromeMetrics.toolbarLeftInset}px`,
} as CSSProperties;

export default function TopNavigation() {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const isProjectDetailPage = /^\/projects\/[^/]+$/.test(pathname);
  const [isDesktop, setIsDesktop] = useState(false);
  const [desktopTabs, setDesktopTabs] = useState<DesktopTab[]>([]);
  const [activeDesktopTabId, setActiveDesktopTabId] = useState<string | null>(null);

  useEffect(() => {
    const desktop = globalThis.__CLASH_DESKTOP__?.isDesktop === true;
    setIsDesktop(desktop);

    if (desktop) {
      const initial = appendDesktopTab([], pathname, `tab-${Date.now().toString(36)}`);
      setDesktopTabs(initial.tabs);
      setActiveDesktopTabId(initial.activeTabId);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop || !activeDesktopTabId) return;
    const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setDesktopTabs((tabs) => {
      const next = activateOrAppendDesktopTab(tabs, pathname, id);
      setActiveDesktopTabId(next.activeTabId);
      return next.tabs;
    });
  }, [activeDesktopTabId, isDesktop, pathname]);

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
      const next = activateOrAppendDesktopTab(tabs, path, id);
      setActiveDesktopTabId(next.activeTabId);
      return next.tabs;
    });
    if (pathname !== path) navigate(path);
  };

  const selectDesktopTab = (tab: DesktopTab) => {
    setActiveDesktopTabId(tab.id);
    if (tab.path !== pathname) navigate(tab.path);
  };

  const closeTab = (tabId: string) => {
    if (!activeDesktopTabId) return;

    const result = closeDesktopTab(
      desktopTabs,
      activeDesktopTabId,
      tabId,
      `tab-${Date.now().toString(36)}-home`,
    );
    setDesktopTabs(result.tabs);
    setActiveDesktopTabId(result.activeTabId);
    if (result.nextPath !== pathname) navigate(result.nextPath);
  };

  if (isDesktop) {
    return (
      <>
        <header
          data-desktop-chrome="true"
          style={desktopChromeStyle}
          className="desktop-drag-region fixed left-0 right-0 top-0 z-50 h-[var(--clash-desktop-chrome-height)] border-b border-[#d8d0c7] bg-[#eeeae4]/95 text-stone-900 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_10px_28px_rgba(35,30,24,0.08)] backdrop-blur-xl"
        >
          <div
            data-desktop-toolbar="true"
            className="flex h-full items-center gap-1 pl-[max(var(--clash-desktop-toolbar-left-inset),env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
          >
            <div
              role="tablist"
              aria-label="Open tabs"
              className="desktop-drag-region flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
            >
              {desktopTabs.map((tab, index) => {
                const active = tab.id === activeDesktopTabId;
                const nextTab = desktopTabs[index + 1];
                const nextActive = nextTab?.id === activeDesktopTabId;
                const showInactiveSeparator = !active && !!nextTab && !nextActive;
                return (
                  <div
                    key={tab.id}
                    data-desktop-tab="true"
                    className={`desktop-no-drag group relative flex h-8 min-w-36 max-w-60 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium transition-colors ${
                      active
                        ? 'border-[#d8d0c7] bg-[#f7f4ef] text-stone-950 shadow-sm'
                        : 'border-transparent bg-transparent text-stone-600 hover:bg-white/45 hover:text-stone-950'
                    }`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => selectDesktopTab(tab)}
                      className="min-w-0 flex-1 truncate text-left focus-visible:outline-none"
                    >
                      {tab.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeTab(tab.id)}
                      aria-label={`Close ${tab.title}`}
                      title={`Close ${tab.title}`}
                      className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full transition-colors ${
                        active
                          ? 'text-stone-500 hover:bg-black/10 hover:text-stone-950'
                          : 'text-stone-400 opacity-0 hover:bg-black/10 hover:text-stone-800 group-hover:opacity-100'
                      }`}
                    >
                      <X className="h-3 w-3" weight="bold" />
                    </button>
                    {showInactiveSeparator && (
                      <span
                        aria-hidden="true"
                        data-desktop-tab-separator="true"
                        className="pointer-events-none absolute right-0 top-1/2 h-5 w-px -translate-y-1/2 bg-[#d8d0c7]/90"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        {!isProjectDetailPage && (
          <div
            style={desktopChromeStyle}
            className="pointer-events-none fixed left-0 right-0 top-[calc(var(--clash-desktop-chrome-height)+0.5rem)] z-40 pb-5"
          >
            <div className="relative flex w-full items-center justify-between pr-[max(2rem,env(safe-area-inset-right))] pl-[max(2rem,env(safe-area-inset-left))] md:px-12">
              <div className="desktop-no-drag pointer-events-auto z-10">
                <button
                  type="button"
                  onClick={() => openPathInDesktopTab('/')}
                  aria-label="Clash home"
                  className="group flex items-center gap-1"
                >
                  <span className="font-display text-3xl font-bold tracking-tighter text-gray-900 leading-none dark:text-slate-50">
                    C
                  </span>
                  <span className="h-7 w-[6px] -skew-x-[20deg] bg-brand" />
                </button>
              </div>

              <nav aria-label="Primary" className="desktop-no-drag pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-warm-border bg-warm-surface px-3 py-2 shadow-md">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => openPathInDesktopTab(item.href)}
                      aria-label={item.name}
                      aria-current={isActive ? 'page' : undefined}
                      className={`relative flex items-center gap-2.5 rounded-full px-5 py-2.5 text-base font-display font-medium transition-colors ${
                        isActive
                          ? 'text-slate-900 dark:text-slate-50'
                          : 'text-slate-700 hover:bg-warm-muted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="desktop-nav-pill"
                          className="absolute inset-0 rounded-full bg-warm-muted"
                          style={{ borderRadius: 9999 }}
                          transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-2.5">
                        <Icon className={`h-5 w-5 ${isActive ? 'text-brand' : ''}`} weight={isActive ? 'fill' : 'regular'} />
                        {item.name}
                      </span>
                    </button>
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
          <Link to="/" className="group flex items-center" aria-label="Clash home">
            <img
              src="/brand/logo-mark.svg"
              alt=""
              className="h-14 w-14 -m-2 object-contain transition-transform duration-150 group-hover:scale-105"
              draggable={false}
            />
          </Link>
        </div>

        {/* Floating Center Nav */}
        <nav aria-label="Primary" className="desktop-no-drag pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-md border border-warm-border bg-warm-surface rounded-full px-3 py-2 flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.name} to={item.href} aria-current={isActive ? 'page' : undefined}>
                <div
                  className={`relative flex items-center gap-2.5 rounded-full px-5 py-2.5 text-base font-display font-medium transition-colors ${
                    isActive
                      ? 'text-slate-900 dark:text-slate-50'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-warm-muted dark:text-slate-300 dark:hover:text-slate-100'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-warm-muted rounded-full"
                      style={{ borderRadius: 9999 }}
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
