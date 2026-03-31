'use client';

import { motion } from 'framer-motion';
import { PencilSimple, UsersThree, Export } from '@phosphor-icons/react';

const steps = [
  {
    number: '01',
    title: 'Describe Your Vision',
    description: 'Type a prompt or paste a script. Our AI breaks it down into scenes, shots, and visual directions automatically.',
    icon: PencilSimple,
    color: 'bg-brand/10 text-brand',
  },
  {
    number: '02',
    title: 'Co-Create with AI',
    description: 'Your AI agent proposes storyboards, generates assets, and refines the edit. You stay in control — approve, tweak, or redirect at any point.',
    icon: UsersThree,
    color: 'bg-indigo-50 text-indigo-600',
  },
  {
    number: '03',
    title: 'Export & Share',
    description: 'Render in minutes. Export optimized for YouTube, TikTok, Instagram, or any platform. One click, every format.',
    icon: Export,
    color: 'bg-emerald-50 text-emerald-600',
  },
];

export default function HowItWorks() {
  return (
    <section className="py-24 sm:py-32 relative z-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">How it works</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl font-display">
            From idea to video in three steps
          </p>
        </div>

        <div className="mx-auto mt-16 max-w-5xl">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {steps.map((step, index) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="relative"
              >
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-14 left-full w-8 h-px border-t-2 border-dashed border-gray-200 -translate-x-4" />
                )}

                <div className="flex flex-col items-center text-center">
                  <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${step.color} mb-6`}>
                    <step.icon className="h-7 w-7" weight="duotone" />
                  </div>
                  <span className="text-xs font-mono font-bold text-gray-400 tracking-widest mb-2">
                    STEP {step.number}
                  </span>
                  <h3 className="text-xl font-bold text-gray-900 font-display mb-3">
                    {step.title}
                  </h3>
                  <p className="text-base text-gray-600 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
