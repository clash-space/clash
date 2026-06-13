
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
    <section className="py-24 sm:py-32 relative z-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">Workspace</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl font-display">
            A studio canvas for human intent and agent work
          </p>
          <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
            Clash keeps the visible work, local runtime, model routing, and cloud collaboration in one product shape.
          </p>
        </div>
        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
          <dl className="grid max-w-xl grid-cols-1 gap-5 lg:max-w-none lg:grid-cols-3">
            {features.map((feature, index) => (
              <motion.div
                key={feature.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className={`flex flex-col rounded-2xl border border-warm-border/80 bg-warm-surface/80 p-7 shadow-[0_10px_28px_rgba(35,31,25,0.04)] transition-all hover:-translate-y-0.5 hover:border-brand/25 hover:bg-warm-surface ${index === 0 ? 'lg:col-span-2' : ''}`}
              >
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-slate-900 dark:text-slate-50 font-display">
                  <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-brand/10">
                    <feature.icon className="h-6 w-6 text-brand" aria-hidden="true" weight="duotone" />
                  </div>
                  {feature.name}
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-stone-700 dark:text-stone-300">
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
