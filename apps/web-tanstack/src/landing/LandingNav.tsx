
import { motion } from 'framer-motion';
import { Link } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';

const navLinks = [
  { name: 'Use Cases', href: '#use-cases' },
  { name: 'Pricing', href: '#pricing' },
  { name: 'Blog', href: '#blog' },
];

export default function LandingNav() {
  const session = authClient.useSession();
  const user = session.data?.user;

  return (
    <header className="pointer-events-none fixed left-0 right-0 top-0 z-50 px-4 py-4">
      <div className="clash-landing-header clash-control-surface pointer-events-auto mx-auto flex h-16 max-w-6xl items-center justify-between rounded-full px-4 pl-5 pr-3 sm:px-5 lg:px-6">
        {/* Logo */}
        <Link to="/" className="group">
          <motion.div
            className="flex items-center gap-1"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span className="font-display text-3xl font-bold tracking-tighter text-slate-950 leading-none">
              Clash
            </span>
            <div className="h-6 w-[5px] bg-brand -skew-x-[20deg] transform origin-center" />
          </motion.div>
        </Link>

        {/* Center Links */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="rounded-full px-3 py-2 text-sm font-medium text-stone-500 transition-colors hover:bg-white/55 hover:text-slate-950"
            >
              {link.name}
            </a>
          ))}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-4">
          {user ? (
            <Link to="/">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/15 transition-all hover:bg-red-600"
              >
                Go to Dashboard
              </motion.button>
            </Link>
          ) : (
            <>
              <Link to="/login">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="rounded-full px-4 py-2 text-sm font-medium text-stone-500 transition-colors hover:bg-white/55 hover:text-slate-950"
                >
                  Sign In
                </motion.button>
              </Link>
              <Link to="/login">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/15 transition-all hover:bg-red-600"
                >
                  Get Started
                </motion.button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
