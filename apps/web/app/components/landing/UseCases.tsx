'use client';

import { motion } from 'framer-motion';
import {
  Storefront,
  GraduationCap,
  TrendUp,
  FilmStrip,
  Headset,
  Globe,
} from '@phosphor-icons/react';

const useCases = [
  {
    title: 'Product Demos',
    description: 'Turn feature lists into polished product walkthroughs. AI generates b-roll, screen recordings with zoom effects, and voiceover narration.',
    icon: Storefront,
    badge: 'Marketing',
  },
  {
    title: 'Educational Content',
    description: 'Transform lesson plans into engaging explainer videos with auto-generated diagrams, animations, and chapter markers.',
    icon: GraduationCap,
    badge: 'Education',
  },
  {
    title: 'Social Media Clips',
    description: 'Create scroll-stopping short-form content. AI optimizes aspect ratios, pacing, and hooks for each platform automatically.',
    icon: TrendUp,
    badge: 'Social',
  },
  {
    title: 'Short Films & Stories',
    description: 'Storyboard entire narratives on the canvas. AI generates scenes, transitions, and soundtrack suggestions to bring your story to life.',
    icon: FilmStrip,
    badge: 'Creative',
  },
  {
    title: 'Podcasts to Video',
    description: 'Turn audio content into visual podcasts with dynamic waveforms, key-point highlights, and AI-generated imagery for each topic.',
    icon: Headset,
    badge: 'Audio',
  },
  {
    title: 'Localization',
    description: 'Produce multilingual versions of any video. AI handles translation, lip-sync adjustments, and culturally-aware visual swaps.',
    icon: Globe,
    badge: 'Enterprise',
  },
];

export default function UseCases() {
  return (
    <section id="use-cases" className="py-24 sm:py-32 relative z-10 bg-gray-50/80 scroll-mt-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16 sm:mb-20">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">Use Cases</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl font-display">
            Built for every kind of creator
          </p>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            Whether you're a solo creator or a production team, Clash adapts to your workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.08 }}
              className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5 transition-all hover:shadow-lg hover:ring-brand/20"
            >
              <div className="flex items-start justify-between mb-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10">
                  <item.icon className="h-6 w-6 text-brand" weight="duotone" />
                </div>
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {item.badge}
                </span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 font-display mb-2">
                {item.title}
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
