
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import TopNavigation from './TopNavigation';
import Background from './Background';
import { ConfirmDialogProvider } from './ConfirmDialog';

export default function LayoutContent({
  children,
  isAuthenticated,
}: {
  children: React.ReactNode;
  isAuthenticated: boolean;
}) {
  const pathname = useLocation().pathname;
  const isDesktop = globalThis.__CLASH_DESKTOP__?.isDesktop === true;

  // 检查是否是项目详情页面或 Landing Page
  const isProjectDetailPage = /^\/projects\/[^\/]+$/.test(pathname ?? '');
  const isDesktopProjectDetailPage = isDesktop && isProjectDetailPage;
  const isLoginPage = pathname === '/login';
  const isLandingPage = pathname === '/landing';
  const isAuthPage = pathname?.startsWith('/auth/');
  const showsDesktopChrome =
    isDesktop && isAuthenticated && !isLoginPage && !isLandingPage && !isAuthPage;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('clash-desktop-route', showsDesktopChrome);
    root.classList.toggle('clash-desktop-project-route', !!isDesktopProjectDetailPage);
    return () => {
      root.classList.remove('clash-desktop-route');
      root.classList.remove('clash-desktop-project-route');
    };
  }, [isDesktopProjectDetailPage, showsDesktopChrome]);

  useEffect(() => {
    if (!showsDesktopChrome) {
      document.documentElement.classList.remove('clash-is-scrolling');
      return undefined;
    }

    const root = document.documentElement;
    let hideTimer: number | undefined;

    const markScrolling = () => {
      root.classList.add('clash-is-scrolling');
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
      }
      hideTimer = window.setTimeout(() => {
        root.classList.remove('clash-is-scrolling');
        hideTimer = undefined;
      }, 450);
    };

    const listenerOptions = { capture: true, passive: true };
    window.addEventListener('scroll', markScrolling, listenerOptions);
    document.addEventListener('scroll', markScrolling, listenerOptions);

    return () => {
      window.removeEventListener('scroll', markScrolling, listenerOptions);
      document.removeEventListener('scroll', markScrolling, listenerOptions);
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
      }
      root.classList.remove('clash-is-scrolling');
    };
  }, [showsDesktopChrome]);

  // If unauthenticated, or on login page, or on fullscreen project page, or explicit landing page
  // Don't show dashboard navigation and background
  if (!isAuthenticated || isLoginPage || (isProjectDetailPage && !isDesktop) || isLandingPage || isAuthPage) {
    return <ConfirmDialogProvider>{children}</ConfirmDialogProvider>;
  }

  // 其他页面 (Dashboard/App): 显示TopNavigation和背景
  return (
    <ConfirmDialogProvider>
      <TopNavigation />
      {!isDesktopProjectDetailPage && <Background />}
      <main
        className={
          isDesktopProjectDetailPage
            ? 'box-border mt-[var(--clash-desktop-chrome-height)] h-[calc(100dvh-var(--clash-desktop-chrome-height))] overflow-hidden [--clash-desktop-chrome-height:2.5rem] [--clash-project-editor-height:calc(100dvh-var(--clash-desktop-chrome-height))]'
            : isDesktop
              ? 'clash-desktop-scroll-root box-border mt-10 h-[calc(100dvh-2.5rem)] overflow-y-auto overflow-x-hidden pt-[4.5rem]'
              : 'min-h-screen pt-24'
        }
      >
        {children}
      </main>
    </ConfirmDialogProvider>
  );
}
