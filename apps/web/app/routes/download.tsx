import Background from "@clash/gui/components/Background";
import LandingNav from "@clash/web-ui/components/landing/LandingNav";
import {
  AppleLogo,
  ArrowSquareOut,
  DownloadSimple,
  LinuxLogo,
  WindowsLogo,
} from "@phosphor-icons/react";

const downloads = [
  {
    platform: "macOS",
    detail: "Apple silicon · M1 and newer",
    ariaLabel: "Download for macOS Apple silicon",
    href: "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-macOS-arm64.dmg",
    icon: AppleLogo,
  },
  {
    platform: "macOS",
    detail: "Intel · x64",
    ariaLabel: "Download for macOS Intel",
    href: "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-macOS-x64.dmg",
    icon: AppleLogo,
  },
  {
    platform: "Windows",
    detail: "64-bit · NSIS installer",
    ariaLabel: "Download for Windows",
    href: "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-Windows-x64.exe",
    icon: WindowsLogo,
  },
  {
    platform: "Linux",
    detail: "64-bit · AppImage",
    ariaLabel: "Download for Linux",
    href: "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-Linux-x64.AppImage",
    icon: LinuxLogo,
  },
] as const;

export default function DownloadRoute() {
  return (
    <div className="clash-landing-page relative min-h-screen overflow-x-hidden">
      <Background />
      <LandingNav />
      <main className="clash-download-page relative z-10 mx-auto min-h-screen w-full max-w-[1120px] px-5 pb-20 pt-36 sm:px-8 sm:pt-40 lg:px-10">
        <p className="font-display text-sm font-semibold text-brand">
          Clash Desktop
        </p>
        <h1 className="mt-4 max-w-4xl font-display text-5xl font-bold tracking-tighter text-slate-950 dark:text-slate-50 sm:text-7xl">
          Download Clash Desktop
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700 dark:text-stone-300">
          The creative platform for agents, packaged for the machine where your
          projects, tools, and agent runtimes live.
        </p>

        <ul
          className="clash-download-grid mt-12"
          aria-label="Desktop installers"
        >
          {downloads.map((download) => (
            <li key={download.ariaLabel}>
              <a
                href={download.href}
                className="clash-download-card"
                aria-label={download.ariaLabel}
              >
                <download.icon
                  className="h-8 w-8"
                  weight="duotone"
                  aria-hidden="true"
                />
                <span>
                  <strong>{download.platform}</strong>
                  <small>{download.detail}</small>
                </span>
                <DownloadSimple
                  className="h-5 w-5"
                  weight="bold"
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </ul>

        <div className="clash-download-notes mt-10">
          <p>
            Preview builds are currently unsigned. Your operating system may ask
            you to confirm that you trust the app.
          </p>
          <a
            href="https://github.com/clash-space/clash/releases/tag/desktop-preview"
            target="_blank"
            rel="noreferrer"
          >
            Release notes
            <ArrowSquareOut
              className="h-4 w-4"
              weight="bold"
              aria-hidden="true"
            />
          </a>
        </div>
      </main>
    </div>
  );
}
