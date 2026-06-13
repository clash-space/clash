import { motion } from 'framer-motion';
import { ArrowRight } from '@phosphor-icons/react';

const posts = [
  {
    title: 'The canvas is the contract',
    excerpt: 'Agent work should land as visible nodes, edges, and lineage instead of disappearing into a chat transcript.',
    category: 'Studio notes',
    signal: 'Intent → node → asset',
    readTime: '6 min',
    date: 'Apr 9, 2026',
    nodes: ['Intent', 'Agent pass', 'Asset'],
  },
  {
    title: 'Local-first agents, cloud when useful',
    excerpt: 'Desktop runtime, BYOK model routes, and cloud sync can fit together without hiding project ownership.',
    category: 'Runtime',
    signal: 'Desktop + daemon',
    readTime: '5 min',
    date: 'Apr 4, 2026',
    nodes: ['clashd', 'Model route', 'Fallback'],
  },
  {
    title: 'Multiplayer without losing the room',
    excerpt: 'Loro, presence, and a cloud sequencer keep shared creative work legible across local and web sessions.',
    category: 'Sync',
    signal: 'Loro + room log',
    readTime: '8 min',
    date: 'Mar 29, 2026',
    nodes: ['You', 'Room', 'Remote'],
  },
];

function NotePath({ nodes }: { nodes: string[] }) {
  return (
    <div className="clash-landing-note-path" aria-hidden="true">
      {nodes.map((node, index) => (
        <span key={node} className="clash-landing-note-node">
          {node}
          {index < nodes.length - 1 && <i />}
        </span>
      ))}
    </div>
  );
}

export default function BlogPreview() {
  return (
    <section id="blog" className="relative z-10 scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.46fr_1fr] lg:gap-20">
          <div>
            <h2 className="font-display text-sm font-semibold leading-7 text-brand">Field notes</h2>
            <p className="mt-2 max-w-md font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              Notes from the working surface
            </p>
            <p className="mt-6 max-w-sm text-base leading-7 text-stone-700 dark:text-stone-300">
              Product thinking for a canvas where people keep intent and agents do visible work.
            </p>
            <motion.a
              href="#"
              className="clash-landing-note-all mt-8 inline-flex items-center gap-2 text-sm font-semibold text-slate-950 transition-colors hover:text-brand dark:text-slate-50"
              whileHover={{ x: 2 }}
            >
              Read all notes
              <ArrowRight className="h-4 w-4" weight="bold" />
            </motion.a>
          </div>

          <ol className="clash-landing-note-ledger" aria-label="Clash field notes">
            {posts.map((post, index) => (
              <motion.li
                key={post.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1], delay: index * 0.06 }}
                className="clash-landing-note-row"
              >
                <div className="clash-landing-note-meta">
                  <span>{post.category}</span>
                  <span>{post.date}</span>
                  <span>{post.readTime}</span>
                </div>

                <a href="#" className="clash-landing-note-copy">
                  <h3>{post.title}</h3>
                  <p>{post.excerpt}</p>
                </a>

                <div className="clash-landing-note-signal">
                  <NotePath nodes={post.nodes} />
                  <span>{post.signal}</span>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
