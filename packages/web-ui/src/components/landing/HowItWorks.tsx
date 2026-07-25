import { motion } from "framer-motion";
import {
  CheckCircle,
  CursorClick,
  GitBranch,
  TerminalWindow,
} from "@phosphor-icons/react";

const steps = [
  {
    number: "01",
    title: "Give the agent a real project",
    description:
      "Start from a brief, references, existing media, or unfinished work. The agent sees context, not an empty prompt box.",
    icon: CursorClick,
  },
  {
    number: "02",
    title: "Let it choose the right tools",
    description:
      "The agent can plan, edit, direct, generate, inspect, and revise through explicit capabilities in the same project.",
    icon: TerminalWindow,
  },
  {
    number: "03",
    title: "Keep every result editable",
    description:
      "Work lands as project state, assets, decisions, and lineage you can inspect or hand to another agent.",
    icon: GitBranch,
  },
  {
    number: "04",
    title: "Invite human judgment",
    description:
      "Review the work, redirect the agent, take over a detail, or approve the next move. You remain welcome at every step.",
    icon: CheckCircle,
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative z-10 scroll-mt-20 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <div className="max-w-2xl">
          <p className="font-display text-sm font-semibold leading-7 text-brand">
            How it works
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
            Agents do the work. Humans keep agency.
          </h2>
          <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
            Creation becomes a legible loop: understand, act, inspect, revise.
            The project—not the conversation—is the durable source of truth.
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
                transition={{
                  duration: 0.42,
                  ease: [0.16, 1, 0.3, 1],
                  delay: index * 0.06,
                }}
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
                  <div
                    className="clash-landing-process-rule"
                    aria-hidden="true"
                  />
                </div>
              </motion.li>
            ))}
          </ol>
          <aside
            className="clash-landing-runtime-panel"
            aria-label="Runtime boundary"
          >
            <span>Clash Desktop</span>
            <strong>The creative environment travels with the project</strong>
            <p>
              Files, agent processes, tools, and project state meet on your
              machine. The agent gets a place to work; you get work you can
              actually open and change.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
