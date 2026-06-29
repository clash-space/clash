
import { motion } from 'framer-motion';
import { DownloadSimple } from '@phosphor-icons/react';
import { Link } from 'react-router';

export default function LandingHero() {
  return (
    <section className="clash-landing-hero relative overflow-hidden px-5 pb-0 pt-24 sm:px-8 sm:pt-28 lg:px-10">
      <div className="clash-hero-stage mx-auto w-full max-w-[1280px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="clash-hero-copy-column mx-auto flex w-full flex-col items-start text-left"
        >
          <h1 className="clash-hero-heading font-display font-bold tracking-tighter text-slate-950 dark:text-slate-50">
            <span>Workspace where</span>
            <span><strong>Agents</strong> and Creators</span>
            <span>Co-create.</span>
          </h1>
          <p className="clash-hero-subtitle mt-5 text-lg font-semibold leading-8 text-stone-700 dark:text-stone-300 sm:text-xl">
            Open-source workbench for agent-assisted creation.
          </p>

          <div className="clash-hero-actions mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/download" className="clash-hero-download">
              <DownloadSimple className="h-5 w-5" weight="bold" aria-hidden="true" />
              <span>Download</span>
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
          className="clash-hero-product-shell"
          aria-label="Clash desktop production workspace preview"
        >
          <div className="clash-hero-window">
            <div className="clash-hero-window-chrome">
              <div className="clash-hero-traffic" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="clash-hero-window-title">clash project - desktop workspace</div>
              <div className="clash-hero-window-status">agent connected</div>
            </div>
            <div className="clash-hero-window-body">
              <aside className="clash-hero-window-sidebar">
                <img src="/brand/logo-mark.svg" alt="" draggable={false} />
                <strong>Launch film</strong>
                <span>local files</span>
                <span>shot board</span>
                <span>agent tasks</span>
              </aside>
              <div className="clash-hero-canvas-preview">
                <div className="clash-hero-node clash-hero-node--brief">
                  <span>script</span>
                  <strong>opening sequence</strong>
                </div>
                <div className="clash-hero-node clash-hero-node--agent">
                  <span>agent</span>
                  <strong>storyboard pass</strong>
                </div>
                <div className="clash-hero-node clash-hero-node--asset">
                  <span>asset</span>
                  <strong>generated shots</strong>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
