import { Link } from "react-router";

export default function TermsRoute() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-slate-950 dark:text-slate-50">
      <Link to="/" className="text-sm text-stone-500 transition-colors hover:text-slate-950 dark:text-stone-400 dark:hover:text-slate-50">
        ← Back
      </Link>
      <h1 className="mt-8 font-display text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-4 text-stone-600 dark:text-stone-300">
        Placeholder. Replace with actual terms before launch.
      </p>
    </div>
  );
}
