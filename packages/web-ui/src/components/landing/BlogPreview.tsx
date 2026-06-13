
import { motion } from 'framer-motion';
import { ArrowRight, Clock } from '@phosphor-icons/react';

const posts = [
  {
    title: 'The canvas is the contract',
    excerpt: 'Why agent work needs to land as visible nodes, edges, and lineage instead of disappearing into a chat transcript.',
    category: 'Studio notes',
    signal: 'Intent → node → asset',
    readTime: '6 min',
    date: 'Apr 9, 2026',
    nodes: ['Intent', 'Agent pass', 'Asset'],
  },
  {
    title: 'Local-first agents, cloud when useful',
    excerpt: 'How the desktop runtime, BYOK model routes, and cloud sync fit together without hiding ownership from the creator.',
    category: 'Runtime',
    signal: 'Desktop + daemon',
    readTime: '5 min',
    date: 'Apr 4, 2026',
    nodes: ['clashd', 'Model route', 'Fallback'],
  },
  {
    title: 'Multiplayer without losing the room',
    excerpt: 'Using Loro, presence, and a cloud sequencer to keep shared creative work legible across local and web sessions.',
    category: 'Sync',
    signal: 'Loro + room log',
    readTime: '8 min',
    date: 'Mar 29, 2026',
    nodes: ['You', 'Room', 'Remote'],
  },
];

function BlogCanvasPreview({ post, index }: { post: (typeof posts)[number]; index: number }) {
  const nodePositions = [
    [
      'left-[12%] top-[34%]',
      'left-[42%] top-[52%]',
      'right-[10%] top-[28%]',
    ],
    [
      'left-[10%] top-[48%]',
      'left-[40%] top-[28%]',
      'right-[12%] top-[54%]',
    ],
    [
      'left-[12%] top-[30%]',
      'left-[42%] top-[46%]',
      'right-[10%] top-[36%]',
    ],
  ][index % 3];

  const path = [
    'M58 72 C136 44 172 116 246 82 S348 56 420 92',
    'M52 92 C124 118 162 42 238 68 S348 120 418 78',
    'M54 66 C142 90 174 96 244 88 S342 54 420 72',
  ][index % 3];

  return (
    <div
      className="clash-blog-preview-canvas relative h-40 overflow-hidden border-b border-warm-border/70 bg-warm-page"
      style={{
        backgroundImage: 'radial-gradient(var(--canvas-dot) 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,254,253,0.72),rgba(255,254,253,0.28)_54%,rgba(255,240,237,0.42))]" />
      <svg className="absolute inset-x-8 top-9 h-20 text-brand/52" viewBox="0 0 480 140" fill="none" aria-hidden="true">
        <path d={path} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="7 8" />
      </svg>
      {post.nodes.map((label, nodeIndex) => (
        <div
          key={label}
          className={`absolute ${nodePositions[nodeIndex]} min-w-[82px] rounded-xl border border-warm-border bg-warm-surface/88 px-3 py-2 shadow-[0_10px_26px_rgba(35,31,25,0.055)] backdrop-blur-sm transition-transform duration-200 group-hover:-translate-y-0.5`}
        >
          <div className="mb-1 h-1.5 w-8 rounded-full bg-brand/70" />
          <div className="text-[11px] font-semibold text-slate-800">{label}</div>
        </div>
      ))}
      <div className="absolute left-5 top-5 inline-flex items-center rounded-lg border border-warm-border bg-warm-surface/86 px-2.5 py-1 text-xs font-medium text-stone-800 shadow-sm">
        {post.category}
      </div>
      <div className="absolute bottom-5 right-5 rounded-lg bg-brand-light/86 px-2.5 py-1 text-[11px] font-semibold text-brand">
        {post.signal}
      </div>
    </div>
  );
}

export default function BlogPreview() {
  return (
    <section id="blog" className="py-24 sm:py-32 relative z-10 bg-warm-muted/45 scroll-mt-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex items-end justify-between mb-12">
          <div>
            <h2 className="text-base font-semibold leading-7 text-brand font-display">Blog</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl font-display">
              Field notes
            </p>
          </div>
          <motion.a
            href="#"
            className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 hover:text-brand transition-colors"
            whileHover={{ x: 2 }}
          >
            Read all notes
            <ArrowRight className="h-4 w-4" weight="bold" />
          </motion.a>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, index) => (
            <motion.a
              key={post.title}
              href="#"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="group flex flex-col overflow-hidden rounded-2xl border border-warm-border/80 bg-warm-surface/88 shadow-[0_10px_28px_rgba(35,31,25,0.04)] transition-all hover:-translate-y-0.5 hover:border-brand/25 hover:bg-warm-surface"
            >
              <BlogCanvasPreview post={post} index={index} />

              <div className="flex flex-1 flex-col p-6">
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 font-display mb-2 group-hover:text-brand transition-colors">
                  {post.title}
                </h3>
                <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed flex-1 mb-4">
                  {post.excerpt}
                </p>
                <div className="flex items-center gap-3 text-xs text-stone-600 dark:text-stone-300">
                  <span>{post.date}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" weight="bold" />
                    {post.readTime}
                  </span>
                </div>
              </div>
            </motion.a>
          ))}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <a href="#" className="text-sm font-medium text-brand hover:text-red-600 transition-colors">
            Read all notes &rarr;
          </a>
        </div>
      </div>
    </section>
  );
}
