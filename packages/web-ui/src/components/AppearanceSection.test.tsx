// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCENT_STORAGE_KEY, THEME_STORAGE_KEY } from '../lib/theme';
import { AppearanceSection } from './SettingsClient';
import { ThemeProvider } from './ThemeProvider';

describe('AppearanceSection', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.removeProperty('--clash-accent');
    document.documentElement.style.removeProperty('--clash-accent-foreground');
  });

  it('switches theme and accent through real persisted controls', () => {
    render(
      <ThemeProvider>
        <AppearanceSection />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: /System/ }).getAttribute('data-state')).toBe('checked');

    fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Studio blue' }));
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('#339CFF');
    expect(document.documentElement.style.getPropertyValue('--clash-accent')).toBe('#339CFF');
    expect(screen.getByRole('button', { name: 'Studio blue' }).getAttribute('aria-pressed')).toBe('true');
  });
});
