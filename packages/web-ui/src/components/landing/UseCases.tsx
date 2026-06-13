
import { motion } from 'framer-motion';
import {
  Aperture,
  BookOpenText,
  Code,
  FilmSlate,
  HardDrives,
  UsersThree,
} from '@phosphor-icons/react';

const useCases = [
  {
    title: 'Solo creator studio',
    description: 'Keep ideas, generated shots, references, and agent notes in one canvas while you move from prompt to rough direction.',
    icon: Aperture,
    badge: 'Solo',
  },
  {
    title: 'Story-first writing',
    description: 'Start with beats and scene intent, then let the canvas carry structure, references, and generation tasks downstream.',
    icon: BookOpenText,
    badge: 'Writing',
  },
  {
    title: 'Agent-assisted production',
    description: 'Ask a local or cloud helper to arrange, inspect, and generate on the canvas while every move stays visible.',
    icon: Code,
    badge: 'Agent',
  },
  {
    title: 'Previs and shot boards',
    description: 'Map scenes, references, image passes, and video drafts as linked nodes instead of losing lineage in a file pile.',
    icon: FilmSlate,
    badge: 'Creative',
  },
  {
    title: 'Local-first work',
    description: 'Use desktop with local storage, local runtime, and BYOK model routes before deciding whether a project needs cloud.',
    icon: HardDrives,
    badge: 'Desktop',
  },
  {
    title: 'Shared review rooms',
    description: 'Turn on sync or multiplayer when collaborators need presence, comments, and the same project graph.',
    icon: UsersThree,
    badge: 'Shared',
  },
];

export default function UseCases() {
  return (
    <section id="use-cases" className="py-24 sm:py-32 relative z-10 bg-warm-muted/45 scroll-mt-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16 sm:mb-20">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">Use Cases</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl font-display">
            Built around how creative work actually moves
          </p>
          <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
            Clash starts light for one person, then grows into local agents, model routes, and shared rooms when the project asks for it.
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
              className="group relative overflow-hidden rounded-2xl border border-warm-border/80 bg-warm-surface/88 p-8 shadow-[0_10px_28px_rgba(35,31,25,0.04)] transition-all hover:-translate-y-0.5 hover:border-brand/25 hover:bg-warm-surface"
            >
              <div className="flex items-start justify-between mb-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10">
                  <item.icon className="h-6 w-6 text-brand" weight="duotone" />
                </div>
                <span className="inline-flex items-center rounded-lg bg-warm-muted px-2.5 py-0.5 text-xs font-medium text-stone-700 dark:text-stone-300">
                  {item.badge}
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 font-display mb-2">
                {item.title}
              </h3>
              <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
