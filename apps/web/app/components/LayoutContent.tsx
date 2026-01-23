'use client';

import { usePathname } from 'next/navigation';
import TopNavigation from './TopNavigation';
import Background from './Background';

export default function LayoutContent({
  children,
  isAuthenticated,
}: {
  children: React.ReactNode;
  isAuthenticated: boolean;
}) {
  const pathname = usePathname();

  // 检查是否是项目详情页面或 Landing Page
  const isProjectDetailPage = pathname?.match(/^\/projects\/[^\/]+$/);
  const isLoginPage = pathname === '/login';
  const isLandingPage = pathname === '/landing';

  // If unauthenticated, or on login page, or on fullscreen project page, or explicit landing page
  // Don't show dashboard navigation and background
  if (!isAuthenticated || isLoginPage || isProjectDetailPage || isLandingPage) {
    return <>{children}</>;
  }

  // 其他页面 (Dashboard/App): 显示TopNavigation和背景
  return (
    <>
      <Background />
      <TopNavigation />
      <main className="pt-24 min-h-screen">
        {children}
      </main>
    </>
  );
}
