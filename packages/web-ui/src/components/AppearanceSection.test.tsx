// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../lib/theme';
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

  it('keeps theme selection while reserving semantic colors for product feedback', () => {
    render(
      <ThemeProvider>
        <AppearanceSection />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: /System/ }).getAttribute('data-state')).toBe('checked');

    fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    expect(screen.getAllByRole('heading', { name: 'Appearance' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy();
    expect(
      screen.getByRole('radiogroup', { name: 'Interface theme' }).closest('[data-slot="settings-panel"]'),
    ).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Accent color' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Studio blue' })).toBeNull();
    expect(screen.queryByLabelText('Custom accent hex color')).toBeNull();
  });
});
