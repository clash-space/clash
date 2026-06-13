
import { motion } from 'framer-motion';
import { Check } from '@phosphor-icons/react';
import { Link } from 'react-router';

const tiers = [
  {
    name: 'Local',
    price: '$0',
    period: 'desktop first',
    description: 'For one person shaping projects on their own machine.',
    features: [
      'Local project graph',
      'Local daemon pairing',
      'Mock AIGC provider',
      'BYOK model routes',
      'No cloud required',
    ],
    cta: 'Get Started',
    href: '/login',
    highlight: false,
  },
  {
    name: 'Synced',
    price: 'Cloud',
    period: 'when useful',
    description: 'For projects that need backup, web access, or another device.',
    features: [
      'Cloud Loro mirror',
      'Remote room messages',
      'Asset metadata sync',
      'Open in Web',
      'Offline changes merge',
      'Explicit sync state',
    ],
    cta: 'Enable Sync',
    href: '/login',
    highlight: true,
  },
  {
    name: 'Shared',
    price: 'Team',
    period: 'multiplayer',
    description: 'For collaborators who need the same canvas at the same time.',
    features: [
      'Cloud sequenced room',
      'Presence and cursors',
      'Project members',
      'Shared messages',
      'Per-user local crew',
      'Permissioned access',
    ],
    cta: 'Invite Team',
    href: '/login',
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 sm:py-32 relative z-10 scroll-mt-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16 sm:mb-20">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">Modes</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl font-display">
            Local by default, cloud when it helps
          </p>
          <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
            The interface should tell users where their work lives and who can join it.
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-3">
          {tiers.map((tier, index) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
                className={`relative flex flex-col rounded-2xl p-8 ${
                  tier.highlight
                  ? 'border border-brand/30 bg-brand-light/55 ring-1 ring-brand/20 shadow-[0_18px_42px_rgba(255,107,80,0.11)] scale-[1.02]'
                  : 'border border-warm-border/80 bg-warm-surface/88 shadow-[0_10px_28px_rgba(35,31,25,0.04)]'
              }`}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-lg border border-brand/24 bg-warm-surface px-3 py-1 text-xs font-bold text-brand shadow-sm shadow-brand/10">
                  Cloud optional
                </span>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-display font-bold text-slate-900 dark:text-slate-50">
                  {tier.name}
                </h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-50">
                    {tier.price}
                  </span>
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {tier.period}
                  </span>
                </div>
                <p className="mt-3 text-sm text-stone-700 dark:text-stone-300">
                  {tier.description}
                </p>
              </div>

              <ul className="flex-1 space-y-3 mb-8">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check
                      className="h-4 w-4 mt-0.5 flex-shrink-0 text-brand"
                      weight="bold"
                    />
                    <span className="text-sm text-stone-700 dark:text-stone-300">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Link to={tier.href}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-full rounded-xl py-3 text-sm font-bold transition-all ${
                    tier.highlight
                      ? 'clash-user-primary'
                      : 'border border-warm-border bg-warm-surface text-slate-900 hover:border-brand/30 hover:bg-warm-muted'
                  }`}
                >
                  {tier.cta}
                </motion.button>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
