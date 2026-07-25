import { motion } from "framer-motion";
import { ArrowUpRight, DownloadSimple } from "@phosphor-icons/react";
import { Link } from "react-router";

const productPreview =
  "https://raw.githubusercontent.com/clash-space/clash/master/.github/social-preview.png";

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
          <p className="clash-hero-eyebrow">
            A creative platform for agents, on your desktop.
          </p>
          <h1
            aria-label="Where agents co-create, humans are welcome too."
            className="clash-hero-heading font-display font-bold tracking-tighter text-slate-950 dark:text-slate-50"
          >
            <span>Where agents</span>
            <span>
              <strong>co-create,</strong>
            </span>
            <span>humans are welcome too.</span>
          </h1>
          <p className="clash-hero-subtitle mt-6 text-lg leading-8 text-stone-700 dark:text-stone-300 sm:text-xl">
            Give agents a real place to see the project, choose their tools,
            make work, and bring it back for human taste and judgment.
          </p>

          <div className="clash-hero-actions mt-9 flex flex-wrap items-center gap-3">
            <Link to="/download" className="clash-hero-download">
              <DownloadSimple
                className="h-5 w-5"
                weight="bold"
                aria-hidden="true"
              />
              <span>Download Clash Desktop</span>
            </Link>
            <a
              href="https://github.com/clash-space/clash"
              className="clash-hero-source"
              target="_blank"
              rel="noreferrer"
            >
              <span>View source</span>
              <ArrowUpRight
                className="h-4 w-4"
                weight="bold"
                aria-hidden="true"
              />
            </a>
          </div>
          <p className="clash-hero-platforms">
            macOS · Windows · Linux · Source available
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
          className="clash-hero-product-shell"
        >
          <figure className="clash-hero-preview">
            <img
              src={productPreview}
              alt="Clash Desktop with creative tools agents can use"
              draggable={false}
            />
            <figcaption>
              <span>Clash Desktop</span>
              <span>One project. Many agent-accessible tools.</span>
            </figcaption>
          </figure>
        </motion.div>
      </div>
    </section>
  );
}
