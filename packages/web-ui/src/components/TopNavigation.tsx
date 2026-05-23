
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { useLocation } from 'react-router';
import {
  House,
  FolderOpen,
  Storefront,
} from '@phosphor-icons/react';
import UserControls from './UserControls';

const navItems = [
  { name: 'Home', href: '/', icon: House },
  { name: 'Projects', href: '/projects', icon: FolderOpen },
  { name: 'Store', href: '/marketplace', icon: Storefront },
];

export default function TopNavigation() {
  const pathname = useLocation().pathname;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6 pointer-events-none">
      <div className="relative flex items-center justify-between w-full pl-[max(2rem,env(safe-area-inset-left))] pr-[max(2rem,env(safe-area-inset-right))] md:px-12">
        {/* Logo Area */}
        <div className="pointer-events-auto z-10">
          <Link to="/" className="group flex items-center gap-1">
            <span className="font-display text-4xl font-bold tracking-tighter text-gray-900 leading-none dark:text-slate-50">
              C
            </span>
            <div className="h-8 w-[6px] bg-brand -skew-x-[20deg] transform origin-center" />
          </Link>
        </div>

        {/* Floating Center Nav */}
        <nav aria-label="Primary" className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-md border border-warm-border bg-warm-surface rounded-full px-3 py-2 flex items-center gap-1">
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
        <div className="pointer-events-auto flex items-center gap-3 z-10">
          <UserControls />
        </div>
      </div>
    </header>
  );
}
