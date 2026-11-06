import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * CSP font allow-list — the site loads its typefaces from Fontshare only
 * (api.fontshare.com serves the CSS, cdn.fontshare.com serves the woff2).
 * Google Fonts was dropped with the Inter load; the allow-list entries stayed
 * behind. An origin nobody requests is pure attack surface, and worse, the
 * three copies of the policy had already drifted: nginx.conf allowed
 * fonts.gstatic.com but NOT cdn.fontshare.com, i.e. an nginx deployment would
 * have blocked the fonts it does use while allowing ones it never loads.
 *
 * This locks: (a) no Google Fonts host anywhere in the policy, (b) the hosts the
 * site actually needs present in every copy, (c) every copy identical for the
 * font-bearing directives, and (d) the policy in sync with pages/+Head.tsx.
 *
 * server.js no longer declares its own policy: it applies security-headers.json
 * (pinned to vercel.json by securityHeadersParity.test.ts), so that file — not
 * server.js — is the source this guard reads for the Express/VPS deployment.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** Every place the production/self-hosted policy is declared. */
const CSP_SOURCES = ['vercel.json', 'security-headers.json', 'nginx.conf'];

/** Directives that decide whether fonts load at all. */
const FONT_DIRECTIVES = ['style-src', 'font-src', 'connect-src'] as const;

/** The subset that must be byte-identical across every CSP source. */
const FONT_CRITICAL = ['style-src', 'font-src'] as const;

const GOOGLE_HOSTS = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/];

/** Every value of every font-bearing directive found in a file. */
function fontDirectiveValues(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const directive of FONT_DIRECTIVES) {
    const re = new RegExp(`(?:^|['";\\s])${directive} ([^;"]*);`, 'g');
    out[directive] = [...text.matchAll(re)].map((m) => m[1].trim());
  }
  return out;
}

/** Hosts in a directive value, in a stable order (for cross-file comparison). */
const hostsOf = (value: string) =>
  (value.match(/https:\/\/[^\s;]+/g) ?? []).slice().sort();

/** Detect a dead/forbidden font host in a policy. Returns the offenders. */
function deadFontHosts(policy: string): string[] {
  return GOOGLE_HOSTS.filter((re) => re.test(policy)).map((re) => String(re));
}

describe('CSP font allow-list', () => {
  it.each(CSP_SOURCES)('%s allows no Google Fonts host', (rel) => {
    const values = fontDirectiveValues(read(rel));
    for (const directive of FONT_DIRECTIVES) {
      for (const value of values[directive]) {
        expect(deadFontHosts(value), `${rel} → ${directive}: ${value}`).toEqual([]);
      }
    }
  });

  it.each(CSP_SOURCES)('%s allows Fontshare (both hosts) where they are needed', (rel) => {
    const values = fontDirectiveValues(read(rel));
    // React renders inline styles, so style-src keeps 'unsafe-inline' — but the
    // Fontshare CSS origin must be allowed or the typefaces never load.
    for (const value of values['style-src']) {
      expect(value).toContain('https://api.fontshare.com');
    }
    // The actual woff2 comes from cdn.fontshare.com — the host nginx.conf missed.
    for (const value of values['font-src']) {
      expect(value).toContain('https://api.fontshare.com');
      expect(value).toContain('https://cdn.fontshare.com');
    }
  });

  // Only the font-bearing directives must agree. connect-src can legitimately
  // differ per deployment target (nginx.conf lists Razorpay endpoints that the
  // Vercel/Express pair may not), so asserting equality there would invent a
  // constraint the app does not have. The font contract is what must not drift.
  it('every copy agrees on the font-bearing directives', () => {
    const [first, ...rest] = CSP_SOURCES.map((rel) => {
      const values = fontDirectiveValues(read(rel));
      // de-duplicate identical directives (server.js declares them once)
      return Object.fromEntries(
        FONT_CRITICAL.map((d) => [d, [...new Set(values[d])].map((v) => hostsOf(v).join(' '))])
      );
    });
    for (const other of rest) {
      expect(other).toEqual(first);
    }
  });

  it('every CSP source keeps the Razorpay checkout origin reachable', () => {
    // A connect-src that drops the payment endpoints breaks checkout, which is
    // exactly how the three copies drifted apart in the first place.
    for (const rel of CSP_SOURCES) {
      const values = fontDirectiveValues(read(rel));
      for (const value of values['connect-src']) {
        expect(value, `${rel} connect-src`).toContain('https://api.razorpay.com');
      }
      for (const value of values['connect-src']) {
        expect(value, `${rel} connect-src`).toContain('supabase.co');
      }
    }
  });

  it('the policy matches what the pages actually request', () => {
    const head = read('pages/+Head.tsx');
    expect(head).toContain('api.fontshare.com');
    expect(deadFontHosts(head)).toEqual([]);
    // the CSP must not be relying on a host the build never emits
    const build = read('scripts/build.mjs');
    expect(deadFontHosts(build)).toEqual([]);
  });
});

describe('the dead-host detector itself (negative control)', () => {
  it('flags a reinstated Google Fonts entry', () => {
    expect(
      deadFontHosts("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com;")
    ).not.toEqual([]);
    expect(deadFontHosts("font-src 'self' data: https://fonts.gstatic.com https://api.fontshare.com;")).not.toEqual([]);
  });

  it('does not flag the Fontshare-only policy', () => {
    expect(deadFontHosts("style-src 'self' 'unsafe-inline' https://api.fontshare.com;")).toEqual([]);
    expect(deadFontHosts("font-src 'self' data: https://api.fontshare.com https://cdn.fontshare.com;")).toEqual([]);
  });

  it('reads the directive values out of a real policy string', () => {
    const values = fontDirectiveValues(
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://api.fontshare.com; " +
        "font-src 'self' data: https://api.fontshare.com https://cdn.fontshare.com; " +
        "connect-src 'self' https://*.supabase.co;"
    );
    expect(values['style-src']).toHaveLength(1);
    expect(values['font-src']).toHaveLength(1);
    expect(hostsOf(values['font-src'][0])).toEqual([
      'https://api.fontshare.com',
      'https://cdn.fontshare.com',
    ]);
  });
});
