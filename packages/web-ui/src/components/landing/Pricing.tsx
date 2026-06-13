import { motion } from 'framer-motion';
import { Link } from 'react-router';

const modes = [
  {
    name: 'Local',
    signal: '$0',
    context: 'desktop first',
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
    emphasis: false,
  },
  {
    name: 'Synced',
    signal: 'Cloud',
    context: 'when useful',
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
    emphasis: true,
  },
  {
    name: 'Shared',
    signal: 'Team',
    context: 'multiplayer',
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
    emphasis: false,
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="relative z-10 scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.62fr_1fr] lg:gap-20">
          <div className="max-w-xl">
            <h2 className="font-display text-sm font-semibold leading-7 text-brand">Modes</h2>
            <p className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              Local by default, cloud when it helps
            </p>
            <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
              The interface should tell users where their work lives and who can join it.
            </p>
          </div>

          <ol className="clash-landing-mode-ledger" aria-label="Clash work modes">
            {modes.map((mode, index) => (
              <motion.li
                key={mode.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: index * 0.06 }}
                className={`clash-landing-mode-row ${mode.emphasis ? 'clash-landing-mode-row--emphasis' : ''}`}
              >
                <div className="clash-landing-mode-index">{String(index + 1).padStart(2, '0')}</div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                    <h3 className="font-display text-xl font-bold text-slate-950 dark:text-slate-50">
                      {mode.name}
                    </h3>
                    <span className="clash-landing-mode-signal">
                      {mode.signal} · {mode.context}
                    </span>
                    {mode.emphasis && <span className="clash-landing-mode-badge">Cloud optional</span>}
                  </div>

                  <p className="mt-3 text-sm leading-6 text-stone-700 dark:text-stone-300">
                    {mode.description}
                  </p>

                  <ul className="clash-landing-mode-features" aria-label={`${mode.name} includes`}>
                    {mode.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>

                <div className="clash-landing-mode-action">
                  <Link
                    to={mode.href}
                    className={mode.emphasis ? 'clash-user-primary clash-landing-mode-link' : 'clash-landing-mode-link'}
                  >
                    {mode.cta}
                  </Link>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
