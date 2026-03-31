'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Clock } from '@phosphor-icons/react';

const posts = [
  {
    title: 'Why We Built Clash: The Anti-Slop Manifesto',
    excerpt: 'AI video tools are flooding the internet with mediocre content. We believe AI should elevate human creativity, not replace it with noise.',
    category: 'Vision',
    readTime: '5 min',
    date: 'Mar 28, 2026',
    gradient: 'from-brand/20 to-orange-100',
  },
  {
    title: 'Sleep-Time Production: Let AI Work While You Rest',
    excerpt: 'How asynchronous AI workflows let you wake up to a finished rough cut — and why that changes the economics of video creation.',
    category: 'Product',
    readTime: '4 min',
    date: 'Mar 25, 2026',
    gradient: 'from-indigo-100 to-violet-100',
  },
  {
    title: 'CRDT-Powered Collaboration for Creative Tools',
    excerpt: 'A deep-dive into how we use Loro CRDTs to enable real-time collaboration between humans and AI agents on the same canvas.',
    category: 'Engineering',
    readTime: '8 min',
    date: 'Mar 20, 2026',
    gradient: 'from-emerald-100 to-teal-100',
  },
];

export default function BlogPreview() {
  return (
    <section id="blog" className="py-24 sm:py-32 relative z-10 bg-gray-50/80 scroll-mt-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex items-end justify-between mb-12">
          <div>
            <h2 className="text-base font-semibold leading-7 text-brand font-display">Blog</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl font-display">
              From the team
            </p>
          </div>
          <motion.a
            href="#"
            className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-brand transition-colors"
            whileHover={{ x: 2 }}
          >
            View all posts
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
              className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 transition-all hover:shadow-lg"
            >
              {/* Gradient header */}
              <div className={`h-40 bg-gradient-to-br ${post.gradient} flex items-end p-6`}>
                <span className="inline-flex items-center rounded-full bg-white/80 backdrop-blur-sm px-2.5 py-0.5 text-xs font-medium text-gray-700">
                  {post.category}
                </span>
              </div>

              <div className="flex flex-1 flex-col p-6">
                <h3 className="text-lg font-bold text-gray-900 font-display mb-2 group-hover:text-brand transition-colors">
                  {post.title}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed flex-1 mb-4">
                  {post.excerpt}
                </p>
                <div className="flex items-center gap-3 text-xs text-gray-400">
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
            View all posts &rarr;
          </a>
        </div>
      </div>
    </section>
  );
}
