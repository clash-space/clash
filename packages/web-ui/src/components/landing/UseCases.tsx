
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
    <section id="use-cases" className="relative z-10 scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.62fr_1fr] lg:gap-20">
          <div className="max-w-xl">
            <h2 className="font-display text-sm font-semibold leading-7 text-brand">Use Cases</h2>
            <p className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              Built around how creative work actually moves
            </p>
            <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
              Clash starts light for one person, then grows into local agents, model routes, and shared rooms when the project asks for it.
            </p>
          </div>

          <ul className="clash-landing-usecase-matrix" aria-label="Creative workflows">
          {useCases.map((item, index) => (
            <motion.li
              key={item.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: index * 0.06 }}
              className={`clash-landing-usecase-row ${index === 0 ? 'clash-landing-usecase-row--lead' : ''}`}
            >
              <div className="clash-landing-usecase-meta">
                <item.icon className="h-5 w-5 text-brand" weight="duotone" aria-hidden="true" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-600 dark:text-stone-300">
                  {item.badge}
                </span>
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-slate-950 dark:text-slate-50">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                  {item.description}
                </p>
              </div>
            </motion.li>
          ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
