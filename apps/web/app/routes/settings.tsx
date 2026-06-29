import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import {
  SettingsSurface,
  isSettingsSection,
  readLastSettingsSection,
  writeLastSettingsSection,
} from "@clash/web-ui/components/SettingsSurface";
import type { SettingsSection } from "@clash/web-ui/components/SettingsClient";

export default function SettingsRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const active: SettingsSection = isSettingsSection(sectionParam)
    ? sectionParam
    : readLastSettingsSection() ?? "agents";

  useEffect(() => {
    writeLastSettingsSection(active);
    if (sectionParam === active) return;
    setSearchParams((next) => {
      next.set("section", active);
      return next;
    }, { replace: true });
  }, [active, sectionParam, setSearchParams]);

  const handleActiveChange = useCallback(
    (section: SettingsSection) => {
      writeLastSettingsSection(section);
      setSearchParams((next) => {
        next.set("section", section);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  return (
    <main className="h-full min-h-[100dvh] w-full overflow-hidden bg-warm-page text-slate-950 dark:text-slate-50 md:min-h-full">
      <SettingsSurface active={active} onActiveChange={handleActiveChange} variant="page" />
    </main>
  );
}
