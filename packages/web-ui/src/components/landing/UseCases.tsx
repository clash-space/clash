import { motion } from "framer-motion";
import {
  Aperture,
  BookOpenText,
  Code,
  FilmSlate,
  Palette,
  ShieldCheck,
} from "@phosphor-icons/react";

const useCases = [
  {
    title: "Set the intent",
    description:
      "Bring the brief, references, constraints, and definition of done. Agents create better when direction is durable.",
    icon: Aperture,
    badge: "Direction",
  },
  {
    title: "Shape the story",
    description:
      "Work with agents on beats, scenes, characters, rhythm, and meaning before polishing individual outputs.",
    icon: BookOpenText,
    badge: "Taste",
  },
  {
    title: "Delegate real production",
    description:
      "Let agents research, arrange, generate, edit, inspect, and revise through tools—not fragile screen mimicry.",
    icon: Code,
    badge: "Agency",
  },
  {
    title: "Direct what matters",
    description:
      "Step in at the level you care about: a creative decision, one shot, an edit, or the whole production.",
    icon: FilmSlate,
    badge: "Control",
  },
  {
    title: "Protect the project",
    description:
      "Keep the working environment close, use your own runtimes and providers, and make every mutation inspectable.",
    icon: ShieldCheck,
    badge: "Trust",
  },
  {
    title: "Bring the human difference",
    description:
      "Taste, judgment, responsibility, and permission stay human—even when agents carry most of the production load.",
    icon: Palette,
    badge: "Human",
  },
];

export default function UseCases() {
  return (
    <section
      id="use-cases"
      className="relative z-10 scroll-mt-20 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.62fr_1fr] lg:gap-20">
          <div className="max-w-xl">
            <p className="font-display text-sm font-semibold leading-7 text-brand">
              The human role
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              Humans bring taste, judgment, and permission
            </h2>
            <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
              “Humans are welcome too” is not a joke about replacement. It is a
              promise that agent autonomy and human authorship can share the
              same creative space.
            </p>
          </div>

          <ul
            className="clash-landing-usecase-matrix"
            aria-label="Creative workflows"
          >
            {useCases.map((item, index) => (
              <motion.li
                key={item.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.42,
                  ease: [0.16, 1, 0.3, 1],
                  delay: index * 0.06,
                }}
                className={`clash-landing-usecase-row ${index === 0 ? "clash-landing-usecase-row--lead" : ""}`}
              >
                <div className="clash-landing-usecase-meta">
                  <item.icon
                    className="h-5 w-5 text-brand"
                    weight="duotone"
                    aria-hidden="true"
                  />
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
