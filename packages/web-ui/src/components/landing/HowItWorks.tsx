
import { motion } from 'framer-motion';
import { CloudCheck, CursorClick, GitBranch, TerminalWindow } from '@phosphor-icons/react';

const steps = [
  {
    number: '01',
    title: 'Start on the local canvas',
    description: 'Type a brief, drop references, or open an existing project. Clash turns intent into editable structure before generation starts.',
    icon: CursorClick,
  },
  {
    number: '02',
    title: 'Attach the right runtime',
    description: 'Use the desktop daemon, local ACP agents, BYOK providers, or managed cloud routes. The interface keeps the runtime visible.',
    icon: TerminalWindow,
  },
  {
    number: '03',
    title: 'Commit work back to the graph',
    description: 'Agent output lands as nodes, assets, notes, and lineage. You can inspect it, revise it, or hand it to another helper.',
    icon: GitBranch,
  },
  {
    number: '04',
    title: 'Invite cloud deliberately',
    description: 'Enable sync or multiplayer only when the project needs web access, backup, or collaborators in the same room.',
    icon: CloudCheck,
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative z-10 scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <div className="max-w-2xl">
          <h2 className="font-display text-sm font-semibold leading-7 text-brand">How it works</h2>
          <p className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
            From idea to canvas to runtime
          </p>
          <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
            Agents do better work when the canvas is the source of truth: the brief is visible, the task is inspectable, and the result lands back where direction happens.
          </p>
        </div>

        <div className="clash-landing-process mt-14">
          <ol>
            {steps.map((step, index) => (
              <motion.li
                key={step.number}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: index * 0.06 }}
              >
                <div className="clash-landing-process-index">
                  <span>{step.number}</span>
                  <step.icon className="h-5 w-5" weight="duotone" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold text-slate-950 dark:text-slate-50">
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-700 dark:text-stone-300">
                    {step.description}
                  </p>
                  <div className="clash-landing-process-rule" aria-hidden="true" />
                </div>
              </motion.li>
            ))}
          </ol>
          <aside className="clash-landing-runtime-panel" aria-label="Runtime boundary">
            <span>desktop runtime</span>
            <strong>Agents run where your files are</strong>
            <p>
              The desktop app is the bridge between the web canvas, local project files, and agent processes. Work leaves the canvas as a task and comes back as editable project material.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
