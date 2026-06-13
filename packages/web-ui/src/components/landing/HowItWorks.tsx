
import { motion } from 'framer-motion';
import { CloudCheck, CursorClick, TerminalWindow } from '@phosphor-icons/react';

const steps = [
  {
    number: '01',
    title: 'Start from intent',
    description: 'Type a brief, drop references, or open an existing canvas. Clash turns the idea into editable project structure.',
    icon: CursorClick,
    color: 'bg-brand/10 text-brand',
  },
  {
    number: '02',
    title: 'Run the right helper',
    description: 'Use cloud agents or attach a local runtime. The agent works in the chat and on the canvas where you can inspect every move.',
    icon: TerminalWindow,
    color: 'bg-warm-muted text-slate-800',
  },
  {
    number: '03',
    title: 'Sync only when useful',
    description: 'Keep work local by default, then enable cloud sync or multiplayer when the project needs web access or collaborators.',
    icon: CloudCheck,
    color: 'bg-warm-muted text-slate-800',
  },
];

export default function HowItWorks() {
  return (
    <section className="py-24 sm:py-32 relative z-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-base font-semibold leading-7 text-brand font-display">How it works</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl font-display">
            From idea to canvas to runtime
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
                  <div className="hidden lg:block absolute top-14 left-full w-8 h-px border-t border-dashed border-warm-border -translate-x-4" />
                )}

                <div className="flex flex-col items-center text-center">
                  <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border border-warm-border/70 ${step.color} mb-6 shadow-[0_8px_20px_rgba(35,31,25,0.04)]`}>
                    <step.icon className="h-7 w-7" weight="duotone" />
                  </div>
                  <span className="text-xs font-mono font-bold text-stone-600 dark:text-stone-300 tracking-widest mb-2">
                    STEP {step.number}
                  </span>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50 font-display mb-3">
                    {step.title}
                  </h3>
                  <p className="text-base text-stone-700 dark:text-stone-300 leading-relaxed">
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
