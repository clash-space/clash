'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import betterAuthClient from '@/lib/betterAuthClient';

const navLinks = [
  { name: 'Use Cases', href: '#use-cases' },
  { name: 'Pricing', href: '#pricing' },
  { name: 'Blog', href: '#blog' },
];

export default function LandingNav() {
  const session = betterAuthClient.useSession();
  const user = session.data?.user;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="group">
          <motion.div
            className="flex items-center gap-1"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span className="font-display text-3xl font-bold tracking-tighter text-gray-900 leading-none">
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
              className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
            >
              {link.name}
            </a>
          ))}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-4">
          {user ? (
            <Link href="/">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-red-600 hover:shadow-md active:shadow-sm"
              >
                Go to Dashboard
              </motion.button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 hover:bg-gray-100/50"
                >
                  Sign In
                </motion.button>
              </Link>
              <Link href="/login">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-red-600 hover:shadow-md active:shadow-sm"
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
