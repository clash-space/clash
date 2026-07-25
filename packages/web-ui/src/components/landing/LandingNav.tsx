import { motion } from "framer-motion";
import { Link } from "react-router";

const navLinks = [{ name: "Docs", href: "/docs" }];

export default function LandingNav() {
  return (
    <header className="pointer-events-none fixed left-0 right-0 top-0 z-50 px-4 py-3">
      <div className="clash-landing-header clash-control-surface pointer-events-auto mx-auto flex h-14 max-w-[1280px] items-center justify-between rounded-2xl px-3 pl-4 pr-2 sm:px-5 lg:px-6">
        {/* Logo */}
        <Link to="/" className="group">
          <motion.div
            className="flex items-center gap-1.5"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <img
              src="/brand/logo-mark.svg"
              alt=""
              className="h-10 w-10 object-contain"
              draggable={false}
            />
            <span className="font-display text-xl font-semibold leading-none text-slate-950 dark:text-slate-50">
              Clash
            </span>
          </motion.div>
        </Link>

        {/* Center Links */}
        <nav className="clash-landing-nav">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              to={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-warm-muted/70 hover:text-slate-950 dark:text-stone-300"
            >
              {link.name}
            </Link>
          ))}
          <a
            href="https://github.com/clash-space/clash"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-warm-muted/70 hover:text-slate-950 dark:text-stone-300"
          >
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Link to="/download" className="clash-desktop-download-placeholder">
            Download
          </Link>
        </div>
      </div>
    </header>
  );
}
