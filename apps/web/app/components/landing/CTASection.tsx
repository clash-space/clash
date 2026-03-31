'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react';

export default function CTASection() {
  return (
    <section className="py-24 sm:py-32 relative z-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-3xl bg-gray-900 px-8 py-20 sm:px-16 sm:py-24 text-center"
        >
          {/* Background decoration */}
          <div className="absolute inset-0 opacity-20">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'radial-gradient(#FF6B50 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-gray-900/60" />

          <div className="relative">
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white font-display mb-6">
              Ready to make some <span className="text-brand">Clash</span>?
            </h2>
            <p className="mx-auto max-w-xl text-lg text-gray-400 mb-10">
              Join creators who are using AI as a creative partner, not a content factory. Start building your first video in minutes.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/login">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center gap-2 rounded-full bg-brand px-8 py-4 text-base font-bold text-white shadow-lg transition-all hover:bg-red-600 hover:shadow-xl"
                >
                  Get Started Free
                  <ArrowRight className="h-5 w-5" weight="bold" />
                </motion.button>
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
