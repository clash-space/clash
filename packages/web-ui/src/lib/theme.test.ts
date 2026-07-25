// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCENT_STORAGE_KEY,
  applyAccentColor,
  applyResolvedTheme,
  DEFAULT_ACCENT_COLOR,
  normalizeAccentColor,
  readAccentColor,
  readThemePreference,
  resolveAccentForeground,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeAccentColor,
  writeThemePreference,
} from './theme';

describe('theme preference', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
  });

  it('reads only supported persisted preferences', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readThemePreference()).toBe('dark');

    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
  });

  it('persists explicit appearance choices', () => {
    writeThemePreference('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('resolves system appearance without changing explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('applies the resolved appearance to native controls and Tailwind variants', () => {
    const root = document.documentElement;

    applyResolvedTheme(root, 'dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');

    applyResolvedTheme(root, 'light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  it('normalizes six- and three-digit custom accent colors', () => {
    expect(normalizeAccentColor('#339cff')).toBe('#339CFF');
    expect(normalizeAccentColor('#f65')).toBe('#FF6655');
    expect(normalizeAccentColor('339cff')).toBe('#339CFF');
    expect(normalizeAccentColor('#12')).toBeNull();
    expect(normalizeAccentColor('tomato')).toBeNull();
  });

  it('persists only valid accents and falls back to the Clash coral', () => {
    writeAccentColor('#0ea5e9');
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('#0EA5E9');
    expect(readAccentColor()).toBe('#0EA5E9');

    window.localStorage.setItem(ACCENT_STORAGE_KEY, 'not-a-color');
    expect(readAccentColor()).toBe(DEFAULT_ACCENT_COLOR);
  });

  it('chooses a readable foreground and applies both accent variables', () => {
    expect(resolveAccentForeground('#FFD54F')).toBe('#181713');
    expect(resolveAccentForeground('#2563EB')).toBe('#FFFAF8');

    applyAccentColor(document.documentElement, '#339cff');
    expect(document.documentElement.style.getPropertyValue('--clash-accent')).toBe('#339CFF');
    expect(document.documentElement.style.getPropertyValue('--clash-accent-foreground')).toBe('#181713');
  });
});
