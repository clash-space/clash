
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
    <header className="fixed top-0 left-0 right-0 z-50 py-6 pointer-events-none">
      <div className="relative flex items-center justify-between w-full px-8 md:px-12">
        {/* Logo Area */}
        <div className="pointer-events-auto z-10">
          <Link to="/" className="group">
            <motion.div
              className="flex items-center gap-1"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
               <span className="font-display text-4xl font-bold tracking-tighter text-gray-900 leading-none">
                C
              </span>
              <div className="h-8 w-[6px] bg-brand -skew-x-[20deg] transform origin-center" />
            </motion.div>
          </Link>
        </div>

        {/* Floating Center Nav */}
        <nav className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-md border border-slate-200 bg-white/80 backdrop-blur-xl rounded-full px-3 py-2 flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.name} to={item.href}>
                <motion.div
                  className={`relative flex items-center gap-2.5 rounded-full px-5 py-2.5 text-base font-display font-medium transition-all ${
                    isActive
                      ? 'text-gray-900'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/50'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 bg-gray-100 rounded-full"
                      style={{ borderRadius: 9999 }}
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2.5">
                    <Icon className={`h-5 w-5 ${isActive ? 'text-brand' : ''}`} weight={isActive ? "fill" : "regular"} />
                    {item.name}
                  </span>
                </motion.div>
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
