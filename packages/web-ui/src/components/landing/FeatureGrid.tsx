
import { motion } from 'framer-motion';
import { GitBranch, HardDrives, PlugsConnected, Sparkle, UsersThree, Waveform } from '@phosphor-icons/react';

const features = [
  {
    name: 'Canvas-first planning',
    description: 'Shape briefs, shots, generated media, and agent work as one editable graph instead of a hidden queue.',
    icon: GitBranch,
  },
  {
    name: 'Local runtime ready',
    description: 'Desktop can pair the web UI with a local daemon, so projects keep moving without making cloud the source of truth.',
    icon: HardDrives,
  },
  {
    name: 'Bring your agents',
    description: 'Connect local coding and creative agents as user-owned helpers. They work for your project, not as a hidden global crew.',
    icon: PlugsConnected,
  },
  {
    name: 'Model routes',
    description: 'Pick models by capability while provider keys stay configurable behind the scenes, including a mock route for development.',
    icon: Sparkle,
  },
  {
    name: 'Cloud when invited',
    description: 'Sync and multiplayer are explicit project modes, so users can tell when work is local-only, synced, or shared.',
    icon: UsersThree,
  },
  {
    name: 'Media-aware tasks',
    description: 'Image, video, and audio processors preserve aspect, duration, prompt, and lineage instead of returning anonymous blobs.',
    icon: Waveform,
  },
];

export default function FeatureGrid() {
  return (
    <section className="relative z-10 py-20 sm:py-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.72fr_1fr] lg:gap-20">
          <div className="max-w-xl">
            <h2 className="font-display text-sm font-semibold leading-7 text-brand">Workspace</h2>
            <p className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              A studio canvas for human intent and agent work
            </p>
            <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
              Clash keeps the visible work, local runtime, model routing, and cloud collaboration in one product shape.
            </p>
          </div>

          <dl className="clash-landing-capability-rail">
            {features.map((feature, index) => (
              <motion.div
                key={feature.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: index * 0.06 }}
                className="clash-landing-capability-row"
              >
                <dt className="flex min-w-0 items-center gap-3 font-display text-base font-semibold leading-7 text-slate-950 dark:text-slate-50">
                  <span className="clash-landing-capability-icon" aria-hidden="true">
                    <feature.icon className="h-5 w-5" weight="duotone" />
                  </span>
                  <span>{feature.name}</span>
                </dt>
                <dd className="text-sm leading-6 text-stone-700 dark:text-stone-300">
                  {feature.description}
                </dd>
              </motion.div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
