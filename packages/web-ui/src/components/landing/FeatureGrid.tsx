
import { motion } from 'framer-motion';

const features = [
  {
    name: 'Canvas project file',
    description: 'Script notes, shots, references, generated media, and tasks stay in the same editable workspace.',
  },
  {
    name: 'Desktop runtime',
    description: 'The desktop app will pair the web UI with local sessions, local files, and agent processes you can inspect.',
  },
  {
    name: 'Bring your agents',
    description: 'Use the agents and model providers you already trust instead of handing the whole project to a black box.',
  },
  {
    name: 'Model routing',
    description: 'Route planning, editing, review, and media tasks to different providers without changing the canvas.',
  },
  {
    name: 'Cloud is optional',
    description: 'Sync and collaboration are explicit modes. Local-first work should stay local until the project needs sharing.',
  },
  {
    name: 'Open source base',
    description: 'The product is built in public, with the source linked from the header and room for self-hosted workflows.',
  },
];

export default function FeatureGrid() {
  return (
    <section id="product" className="relative z-10 scroll-mt-20 py-18 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.72fr_1fr] lg:gap-20">
          <div className="max-w-xl">
            <h2 className="font-display text-sm font-semibold leading-7 text-brand">Workspace</h2>
            <p className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              One project surface, not a prompt queue
            </p>
            <p className="mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300">
              Clash is for directing agent work around real project material: references, cuts, generated assets, notes, and review states.
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
                <dt className="min-w-0">
                  <span className="block font-display text-base font-semibold leading-7 text-slate-950 dark:text-slate-50">{feature.name}</span>
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
