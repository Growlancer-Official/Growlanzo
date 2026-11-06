/**
 * Feature flags must actually read their `VITE_FEATURE_*` env vars.
 *
 * They did not. The lookup was `import.meta.env?.[`VITE_FEATURE_${…}_ENABLED`]`,
 * and Vike replaces a bare `import.meta.env` expression with `null` at build
 * time — a warning it printed on every build. The computed access therefore
 * evaluated `null?.[key]` → `undefined`, so every feature silently stayed on its
 * fail-closed default and `VITE_FEATURE_CONTESTS_ENABLED=true`, the documented
 * way to enable a module, had no effect in the shipped bundle. A default-only
 * test could not see that, so this asserts the flip in both directions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDeferredRoute, isFeatureEnabled } from '../lib/featureFlags';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('feature flags read their env var', () => {
  it('defaults to OFF when nothing is set (fail-closed)', () => {
    expect(isFeatureEnabled('contests')).toBe(false);
    expect(isFeatureEnabled('internships')).toBe(false);
    expect(isFeatureEnabled('certificates')).toBe(false);
  });

  it('turns a feature ON for the exact string "true"', () => {
    vi.stubEnv('VITE_FEATURE_CONTESTS_ENABLED', 'true');
    expect(isFeatureEnabled('contests')).toBe(true);
    // Independent flags must not leak into each other.
    expect(isFeatureEnabled('internships')).toBe(false);
  });

  it('honours an explicit "false" over the default', () => {
    vi.stubEnv('VITE_FEATURE_CERTIFICATES_ENABLED', 'false');
    expect(isFeatureEnabled('certificates')).toBe(false);
  });

  it('ignores a non-exact value ("1", "TRUE") rather than guessing', () => {
    vi.stubEnv('VITE_FEATURE_INTERNSHIPS_ENABLED', '1');
    expect(isFeatureEnabled('internships')).toBe(false);
    vi.stubEnv('VITE_FEATURE_INTERNSHIPS_ENABLED', 'TRUE');
    expect(isFeatureEnabled('internships')).toBe(false);
  });

  it('a real env flip changes route gating, not just the getter', () => {
    // The point of the flag: with contests enabled the route is no longer
    // deferred, so the nav entry and the router agree with the server switch.
    expect(isDeferredRoute('/contests')).toBe(true);
    vi.stubEnv('VITE_FEATURE_CONTESTS_ENABLED', 'true');
    expect(isDeferredRoute('/contests')).toBe(false);
    expect(isDeferredRoute('/contests/abc')).toBe(false);
    // A neighbouring path must not be swallowed by prefix matching.
    expect(isDeferredRoute('/client/contracts')).toBe(false);
  });

  it('keeps a source guard against the bare import.meta.env that caused it', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(process.cwd(), 'src/lib/featureFlags.ts'),
      'utf8'
    );
    // Bare `import.meta.env` (not followed by a property access) is the bug.
    // Strip comment lines first: the explanation above has to NAME the retired
    // expression, and a naive scan would fail on its own documentation.
    const code = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/import\.meta\.env(?!\.)/);
  });
});
