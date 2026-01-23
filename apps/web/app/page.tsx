/**
 * @file page.tsx
 * @description Main entry point for the Web application.
 * @module apps.web.app
 *
 * @responsibility
 * - Checks user authentication status
 * - Shows landing page for unauthenticated users
 * - Shows dashboard (HomePageClient) for authenticated users
 * - Enforces dynamic rendering to ensure fresh data
 *
 * @exports
 * - HomePage: The async page component
 */
import { getProjects } from './actions';
import HomePageClient from './components/HomePageClient';
import { getUserIdFromHeaders } from '@/lib/auth/session';
import { headers } from 'next/headers';
import LandingPage from './landing/page';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Check if user is authenticated
  const h = new Headers(await headers());
  const userId = await getUserIdFromHeaders(h);

  // If not authenticated (and not in dev mode), show landing page
  if (!userId) {
    return <LandingPage />;
  }

  // If authenticated, show dashboard
  const projects = await getProjects(5);
  return <HomePageClient initialProjects={projects} />;
}
