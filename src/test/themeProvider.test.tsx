import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

/**
 * Light-only theme.
 *
 * Dark mode was removed: the site must look the same on every device, whatever
 * the OS setting or a returning visitor's stored preference says. That is a
 * guarantee with two halves, and both are asserted here:
 *   1. the pre-paint guard (injected by scripts/build.mjs into every built page)
 *      strips `.dark` and pins `color-scheme: light` before anything paints;
 *   2. ThemeProvider repeats it after hydration, so a stale class can never
 *      survive a client-side render.
 */

function stubMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  window.matchMedia = vi.fn().mockImplementation(() => mql) as unknown as typeof window.matchMedia;
}

function Probe() {
  const { preference, resolved } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
    </div>
  );
}

describe('ThemeProvider (light only)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(cleanup);

  it('reports light regardless of a dark system preference', async () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved').textContent).toBe('light'));
    expect(screen.getByTestId('preference').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('removes a stale .dark class and pins color-scheme to light', async () => {
    stubMatchMedia(true);
    document.documentElement.classList.add('dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('deletes the retired theme preference instead of reading it', async () => {
    localStorage.setItem('growlancer-theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(localStorage.getItem('growlancer-theme')).toBeNull());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('renders identical markup for every visitor (no hydration mismatch)', () => {
    localStorage.setItem('growlancer-theme', 'dark');
    const first = renderToString(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    localStorage.setItem('growlancer-theme', 'light');
    const second = renderToString(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(first).toBe(second);
    expect(first).toContain('light');
  });

  it('ships a guard that enforces light before the first paint', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    // The guard is defined in scripts/build.mjs and injected into every page
    // after Vike has written its HTML. It used to live in vite.config.ts's
    // closeBundle plugin, which ran too early to survive (measured 2026-11-22).
    const buildScript = readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8');
    expect(buildScript).toContain('THEME_FOUC_GUARD');
    expect(buildScript).toContain("classList.remove('dark')");
    expect(buildScript).not.toContain("classList.add('dark')");
    expect(buildScript).not.toContain('prefers-color-scheme');
  });
});
