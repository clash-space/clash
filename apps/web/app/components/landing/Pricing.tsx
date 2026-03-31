'use client';

import { motion } from 'framer-motion';
import { Check } from '@phosphor-icons/react';
import Link from 'next/link';

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For hobbyists exploring AI video creation.',
    features: [
      '3 projects',
      '720p export',
      '5 AI generations / month',
      'Community support',
      'Watermark on exports',
    ],
    cta: 'Get Started',
    href: '/login',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/ month',
    description: 'For creators who ship content regularly.',
    features: [
      'Unlimited projects',
      '4K export',
      '200 AI generations / month',
      'Priority rendering',
      'No watermark',
      'CLI & API access',
      'Custom brand kit',
    ],
    cta: 'Start Free Trial',
    href: '/login',
    highlight: true,
  },
  {
    name: 'Team',
    price: '$79',
    period: '/ month',
    description: 'For teams collaborating on video at scale.',
    features: [
      'Everything in Pro',
      'Unlimited AI generations',
      '5 team members',
      'Real-time collaboration',
      'Shared asset library',
      'SSO & audit logs',
      'Dedicated support',
    ],
    cta: 'Contact Sales',
    href: '/login',
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 sm:py-32 relative z-10 scroll-mt-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16 sm:mb-20">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">Pricing</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl font-display">
            Simple, transparent pricing
          </p>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            Start free. Upgrade when you're ready. No surprises.
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
                  ? 'bg-gray-900 text-white ring-2 ring-brand shadow-xl scale-[1.02]'
                  : 'bg-white ring-1 ring-black/5 shadow-sm'
              }`}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">
                  Most Popular
                </span>
              )}

              <div className="mb-6">
                <h3 className={`text-lg font-display font-bold ${tier.highlight ? 'text-white' : 'text-gray-900'}`}>
                  {tier.name}
                </h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className={`text-4xl font-display font-bold tracking-tight ${tier.highlight ? 'text-white' : 'text-gray-900'}`}>
                    {tier.price}
                  </span>
                  <span className={`text-sm ${tier.highlight ? 'text-gray-400' : 'text-gray-500'}`}>
                    {tier.period}
                  </span>
                </div>
                <p className={`mt-3 text-sm ${tier.highlight ? 'text-gray-400' : 'text-gray-600'}`}>
                  {tier.description}
                </p>
              </div>

              <ul className="flex-1 space-y-3 mb-8">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check
                      className={`h-4 w-4 mt-0.5 flex-shrink-0 ${tier.highlight ? 'text-brand' : 'text-brand'}`}
                      weight="bold"
                    />
                    <span className={`text-sm ${tier.highlight ? 'text-gray-300' : 'text-gray-600'}`}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Link href={tier.href}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-full rounded-xl py-3 text-sm font-bold transition-all ${
                    tier.highlight
                      ? 'bg-brand text-white hover:bg-red-600 shadow-lg'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
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
