
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

  // 检查是否是项目详情页面或 Landing Page
  const isProjectDetailPage = pathname?.match(/^\/projects\/[^\/]+$/);
  const isLoginPage = pathname === '/login';
  const isLandingPage = pathname === '/landing';
  const isSettingsPage = pathname === '/settings';
  const isAuthPage = pathname?.startsWith('/auth/');

  // If unauthenticated, or on login page, or on fullscreen project page, or explicit landing page
  // Don't show dashboard navigation and background
  if (!isAuthenticated || isLoginPage || isProjectDetailPage || isLandingPage || isSettingsPage || isAuthPage) {
    return <ConfirmDialogProvider>{children}</ConfirmDialogProvider>;
  }

  // 其他页面 (Dashboard/App): 显示TopNavigation和背景
  return (
    <ConfirmDialogProvider>
      <Background />
      <TopNavigation />
      <main className="pt-24 min-h-screen">
        {children}
      </main>
    </ConfirmDialogProvider>
  );
}
