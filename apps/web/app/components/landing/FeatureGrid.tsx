'use client';

import { motion } from 'framer-motion';
import { MagicWand, VideoCamera, ShareNetwork, Robot, Palette, Lightning } from '@phosphor-icons/react';

const features = [
  {
    name: 'AI Script Generation',
    description: 'Turn a simple prompt into a full video script with scenes, dialogue, and visual descriptions.',
    icon: MagicWand,
  },
  {
    name: 'Smart Video Editing',
    description: 'Our AI engine automatically selects the best stock footage and assembles your video perfectly.',
    icon: VideoCamera,
  },
  {
    name: 'Instant Sharing',
    description: 'Export your videos in multiple formats optimized for YouTube, TikTok, Instagram, and more.',
    icon: ShareNetwork,
  },
  {
    name: 'Digital Avatars',
    description: 'Use lifelike AI avatars to narrate your videos in multiple languages and accents.',
    icon: Robot,
  },
  {
    name: 'Brand Customization',
    description: 'Apply your brand colors, fonts, and logos to every video with a single click.',
    icon: Palette,
  },
  {
    name: 'Lightning Fast',
    description: 'Generate professional videos in minutes. Say goodbye to long rendering times.',
    icon: Lightning,
  },
];

export default function FeatureGrid() {
  return (
    <section className="py-24 sm:py-32 relative z-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">Features</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl font-display">
            Everything you need to create amazing videos
          </p>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            Powerful tools that help you tell your story, without the technical complexity.
          </p>
        </div>
        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
          <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
            {features.map((feature, index) => (
              <motion.div
                key={feature.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="flex flex-col rounded-[1.5rem] bg-white/60 backdrop-blur-md p-8 shadow-sm ring-1 ring-black/5 hover:shadow-lg transition-all hover:bg-white/80"
              >
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-gray-900 font-display">
                  <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-brand/10">
                    <feature.icon className="h-6 w-6 text-brand" aria-hidden="true" weight="duotone" />
                  </div>
                  {feature.name}
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">{feature.description}</p>
                </dd>
              </motion.div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
