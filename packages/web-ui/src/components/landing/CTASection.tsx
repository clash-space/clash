
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { ArrowRight, GitBranch } from '@phosphor-icons/react';

export default function CTASection() {
  return (
    <section className="relative z-10 py-20 sm:py-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="clash-landing-agent-cta"
        >
          <div className="clash-landing-agent-cta-mark" aria-hidden="true">
            <GitBranch className="h-7 w-7" weight="duotone" />
          </div>

          <div>
            <h2 className="max-w-2xl font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-5xl">
              Open a canvas agents can work inside.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700 dark:text-stone-300">
              Start with direction, attach a helper, and keep every generated asset connected to the decision that made it.
            </p>
          </div>

          <Link to="/login" className="clash-user-primary clash-landing-agent-cta-button">
            Open a Canvas
            <ArrowRight className="h-5 w-5" weight="bold" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
