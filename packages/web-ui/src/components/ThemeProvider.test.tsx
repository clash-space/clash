// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCENT_STORAGE_KEY, THEME_STORAGE_KEY } from '../lib/theme';
import { ThemeProvider, useTheme } from './ThemeProvider';

function ThemeProbe() {
  const { accentColor, preference, resolvedTheme, setAccentColor, setPreference } = useTheme();
  return (
    <div>
      <output>{preference}:{resolvedTheme}:{accentColor}</output>
      <button type="button" onClick={() => setPreference('light')}>Light</button>
      <button type="button" onClick={() => setPreference('dark')}>Dark</button>
      <button type="button" onClick={() => setPreference('system')}>System</button>
      <button type="button" onClick={() => setAccentColor('#339cff')}>Ocean accent</button>
    </div>
  );
}

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal('matchMedia', vi.fn(() => media));

  return {
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next, media: media.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

describe('ThemeProvider', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
  });

  it('hydrates a persisted preference and updates it immediately', () => {
    installMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(screen.getByText('dark:dark:#FF6B50')).toBeTruthy();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));

    expect(screen.getByText('light:light:#FF6B50')).toBeTruthy();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('tracks operating-system appearance while System is selected', () => {
    const media = installMatchMedia(false);

    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(screen.getByText('system:light:#FF6B50')).toBeTruthy();

    act(() => media.setMatches(true));

    expect(screen.getByText('system:dark:#FF6B50')).toBeTruthy();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('hydrates and persists a custom accent color', () => {
    installMatchMedia(false);
    window.localStorage.setItem(ACCENT_STORAGE_KEY, '#0EA5E9');

    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(screen.getByText('system:light:#0EA5E9')).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--clash-accent')).toBe('#0EA5E9');

    fireEvent.click(screen.getByRole('button', { name: 'Ocean accent' }));

    expect(screen.getByText('system:light:#339CFF')).toBeTruthy();
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('#339CFF');
    expect(document.documentElement.style.getPropertyValue('--clash-accent')).toBe('#339CFF');
  });
});
