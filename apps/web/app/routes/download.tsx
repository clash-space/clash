import Background from "@clash/web-ui/components/Background";
import LandingNav from "@clash/web-ui/components/landing/LandingNav";

export default function DownloadRoute() {
  return (
    <div className="clash-landing-page relative min-h-screen overflow-x-hidden">
      <Background />
      <LandingNav />
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1120px] flex-col items-center justify-center px-5 text-center sm:px-8 lg:px-10">
        <p className="font-display text-sm font-semibold text-brand">Download</p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl font-bold tracking-tighter text-slate-950 dark:text-slate-50 sm:text-7xl">
          Clash Desktop is coming soon.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700 dark:text-stone-300">
          Desktop builds will appear here when the installer is ready.
        </p>
      </main>
    </div>
  );
}
