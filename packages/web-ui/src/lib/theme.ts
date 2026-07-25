export const THEME_STORAGE_KEY = 'clash.appearance';
export const ACCENT_STORAGE_KEY = 'clash.accent';
export const DEFAULT_ACCENT_COLOR = '#FF6B50';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export function normalizeAccentColor(value: string | null): string | null {
  const candidate = value?.trim().replace(/^#/, '') ?? '';
  if (/^[0-9a-f]{3}$/i.test(candidate)) {
    return `#${candidate
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('')}`.toUpperCase();
  }
  return /^[0-9a-f]{6}$/i.test(candidate)
    ? `#${candidate.toUpperCase()}`
    : null;
}

export function readAccentColor(): string {
  try {
    return (
      normalizeAccentColor(browserStorage()?.getItem(ACCENT_STORAGE_KEY) ?? null) ??
      DEFAULT_ACCENT_COLOR
    );
  } catch {
    return DEFAULT_ACCENT_COLOR;
  }
}

export function writeAccentColor(color: string): void {
  const normalized = normalizeAccentColor(color);
  if (!normalized) return;
  try {
    browserStorage()?.setItem(ACCENT_STORAGE_KEY, normalized);
  } catch {
    // The active accent still applies for this session when storage is blocked.
  }
}

function relativeLuminance(color: string): number {
  const normalized = normalizeAccentColor(color) ?? DEFAULT_ACCENT_COLOR;
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function resolveAccentForeground(color: string): string {
  const darkForeground = '#181713';
  const lightForeground = '#FFFAF8';
  return contrastRatio(color, darkForeground) >= contrastRatio(color, lightForeground)
    ? darkForeground
    : lightForeground;
}

export function applyAccentColor(root: HTMLElement, color: string): void {
  const normalized = normalizeAccentColor(color) ?? DEFAULT_ACCENT_COLOR;
  root.style.setProperty('--clash-accent', normalized);
  root.style.setProperty(
    '--clash-accent-foreground',
    resolveAccentForeground(normalized),
  );
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readThemePreference(): ThemePreference {
  try {
    const value = browserStorage()?.getItem(THEME_STORAGE_KEY) ?? null;
    return isThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    browserStorage()?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The active theme still applies for this session when storage is blocked.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
}

export function applyResolvedTheme(
  root: HTMLElement,
  theme: ResolvedTheme,
): void {
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
