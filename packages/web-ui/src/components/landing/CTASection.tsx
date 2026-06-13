
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { ArrowRight } from '@phosphor-icons/react';

export default function CTASection() {
  return (
    <section className="py-24 sm:py-32 relative z-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-[28px] border border-warm-border/80 bg-warm-surface/88 px-8 py-20 text-center shadow-[0_20px_60px_rgba(35,31,25,0.08)] sm:px-16 sm:py-24"
        >
          <div className="absolute inset-0 opacity-45" aria-hidden="true">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'radial-gradient(rgba(35,31,25,0.2) 1px, transparent 1px)',
                backgroundSize: '22px 22px',
              }}
            />
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_76%_22%,rgba(255,107,80,0.13),transparent_26%),linear-gradient(180deg,rgba(255,254,253,0.72),rgba(255,254,253,0.9))]" />

          <div className="relative">
            <h2 className="mx-auto mb-6 max-w-2xl font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              Start local. Add cloud only when the project needs it.
            </h2>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-stone-700">
              Open a canvas, attach your helper, and keep every generated asset connected to the work that made it.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link to="/login">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="clash-user-primary flex items-center gap-2 rounded-xl px-8 py-4 text-base font-bold"
                >
                  Open a Canvas
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
