import { motion } from "framer-motion";

const features = [
  {
    name: "A project agents can understand",
    description:
      "Briefs, media, decisions, tasks, and revision state live together instead of disappearing into a chat transcript.",
  },
  {
    name: "Canvas",
    description:
      "A visual thinking tool for arranging ideas, references, assets, and agent work as one inspectable graph.",
  },
  {
    name: "Timeline",
    description:
      "A time-based tool agents can use for cuts, captions, motion, sound, effects, and final delivery.",
  },
  {
    name: "Director Stage",
    description:
      "A spatial tool for blocking performers, cameras, actions, and shots before expensive generation begins.",
  },
  {
    name: "Bring your own agents",
    description:
      "Connect Codex, ACP, MCP, CLI, and the model providers you trust through explicit project contracts.",
  },
  {
    name: "Human agency by design",
    description:
      "Inspect what changed, revise the result, reject a pass, or step into the work whenever your judgment matters.",
  },
];

export default function FeatureGrid() {
  return (
    <section id="product" className="relative z-10 scroll-mt-20 py-18 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.72fr_1fr] lg:gap-20">
          <div className="max-w-xl">
            <p className="font-display text-sm font-semibold leading-7 text-brand">
              What Clash is
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              A creative platform, not another AI feature
            </h2>
            <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
              Agents are first-class creators here. Clash gives them a project
              to understand, tools to act with, and a visible path back to you.
            </p>
          </div>

          <div>
            <h3 className="mb-5 font-display text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
              Tools agents can see, use, and change
            </h3>
            <dl className="clash-landing-capability-rail">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.name}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.42,
                    ease: [0.16, 1, 0.3, 1],
                    delay: index * 0.06,
                  }}
                  className="clash-landing-capability-row"
                >
                  <dt className="min-w-0">
                    <span className="block font-display text-base font-semibold leading-7 text-slate-950 dark:text-slate-50">
                      {feature.name}
                    </span>
                  </dt>
                  <dd className="text-sm leading-6 text-stone-700 dark:text-stone-300">
                    {feature.description}
                  </dd>
                </motion.div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
