import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dark theme — the coverage guard.
 *
 * Why this shape: the site does NOT carry `dark:` variants on ~100 pages. The
 * theme is implemented ONCE as a palette remap in `src/styles/globals.css`
 * (`.dark :where(.bg-white) { … }`), and `darkMode: 'class'` + ThemeContext do
 * the switching. That is what makes a sitewide dark theme tractable — and it is
 * also the exact thing that rots silently: somebody reaches for a palette the
 * remap never knew about (a `gray`/`zinc`/`stone` chip, say), the page looks
 * right in light, and in dark mode that one element stays bright. Nothing
 * fails, no test notices, and the report is "dark mode is broken again".
 *
 * So this test reads the two real sources of truth — the remap selectors in
 * globals.css and every colour utility actually written in src/ — and demands
 * that each light-rendering token is either remapped or excused BY NAME with a
 * reason. An excuse that is no longer needed also fails, so the list cannot
 * grow into a dumping ground.
 *
 * Four classes of defect are locked down here, all measured in the
 * 2026-10-18 dark-mode sweep:
 *   1. a token the remap never listed (now including `/alpha` spellings and
 *      state variants like `hover:bg-slate-50`, which used to flash near-white
 *      on hover),
 *   2. an arbitrary `bg-[#F8FAFC]` page shell — the class name is opaque to the
 *      remap, so whole pages stayed bright; they now use `bg-slate-50`,
 *   3. a remap rule with the state pseudo INSIDE `:where()`, which silently
 *      loses specificity and looks like it works,
 *   4. a state remap inside `@layer utilities`, where Tailwind emits its own
 *      generated variant utilities AFTER user content (so an equal-specificity
 *      rule loses on order) and rewrites `:where(.x):hover` into
 *      `:where(.x:hover)`. The state block therefore sits outside the layer and
 *      carries an `html.dark` prefix for the extra specificity — both are
 *      asserted below because both were required to make the fix real.
 *
 * If this test fails after you added a class: add the class to the remap in
 * globals.css (preferred), or add it to EXCUSED with a real reason.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const ROOT = path.resolve(SRC, '..');
const stroke = (p: string) => p.split(path.sep).join('/');
const readRepo = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const CSS = fs.readFileSync(path.join(SRC, 'styles/globals.css'), 'utf8');

// ── 1. What the remap covers ────────────────────────────────────────────────
/** Tailwind escapes `:` `.` `/` `[` `]` `#` inside a class name. */
const unescapeClass = (selector: string) => selector.slice(1).replace(/\\(.)/g, '$1');

/**
 * Every class name in a `.dark … :where(…)` selector, unescaped, including the
 * variant prefix (`hover:bg-white`). The `:where(args)` argument is taken
 * verbatim — state pseudos are deliberately OUTSIDE it (see the shape test).
 */
function remappedClasses(css: string): Set<string> {
  const out = new Set<string>();
  // Rule-by-rule, selector list intact: a `.dark A, .dark B { … }` pair must
  // yield BOTH A and B. A per-`:where()` regex silently dropped every selector
  // but the first in a list, which is how `active:bg-slate-100` stayed
  // invisible to this guard even after it was remapped.
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1];
    if (!selector.includes('.dark')) continue;
    for (const where of selector.matchAll(/:where\(([^)]*)\)/g)) {
      for (const raw of where[1].split(',')) {
        const sel = raw.trim();
        if (!sel.startsWith('.')) continue;
        out.add(unescapeClass(sel));
      }
    }
  }
  return out;
}

const COVERED = remappedClasses(CSS);

// ── 2. Every colour utility actually used in src/ ───────────────────────────
const PALETTE =
  'white|black|cream|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY = 'bg|text|border|divide|ring|from|to|via|fill|stroke|placeholder|ring-offset';
/** `hover:` `focus:` `group-hover:` … — these change the compiled specificity. */
const STATE =
  'hover|focus|focus-visible|focus-within|active|group-hover|file|disabled|checked';
const TOKEN_RE = new RegExp(
  `(?:^|[\\s"'\`{(])((?:(?:${STATE}):+)?(?:${UTILITY})-(?:${PALETTE})(?:-\\d+)?(?:\\/[\\d.]+)?)`,
  'g'
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const usedTokens = new Map<string, Set<string>>();
for (const file of sourceFiles(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[1];
    if (!usedTokens.has(token)) usedTokens.set(token, new Set());
    usedTokens.get(token)!.add(stroke(path.relative(SRC, file)));
  }
}
const USED = [...usedTokens.keys()].sort();

// ── 3. Which of them render LIGHT, and so must not survive into dark mode ───
/**
 * Only tokens that paint a near-white surface or dark-on-light text are in
 * scope. Deliberately out of scope, because they read correctly in BOTH themes:
 *   - `text-white` / `text-slate-400…100` (already light),
 *   - `bg-slate-700+`, `bg-emerald-500+` (already dark / saturated),
 *   - `bg-black/*`, `bg-white/5…40` (translucent overlays on dark chrome).
 */
const LIGHT_TINT = '(50|100|200|300)';
const NEUTRALS = 'slate|gray|grey|zinc|neutral|stone';
const ACCENTS =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
/** Tailwind bakes `/alpha` into a class of its own, so it must be classified. */
const alphaOf = (token: string): number | null => {
  const m = /\/(\d+)$/.exec(token);
  return m ? Number(m[1]) : null;
};
/** A surface at <50% alpha is a translucent wash over dark chrome, not a tile. */
const isOpaqueEnough = (token: string) => {
  const alpha = alphaOf(token);
  return alpha === null || alpha >= 50;
};
/** The token without its alpha suffix — the shape the remap selector mirrors. */
const stripAlpha = (token: string) => token.replace(/\/\d+$/, '');

/** Variant prefixes are part of the token — strip them for the shape test only. */
const baseToken = (token: string) => token.slice(token.lastIndexOf(':') + 1);

/**
 * Only tokens that paint a near-white surface or dark-on-light text are in
 * scope. Deliberately out of scope, because they read correctly in BOTH themes:
 *   - `text-white` / `text-slate-400…100` (already light),
 *   - `bg-slate-700+`, `bg-emerald-500+` (already dark / saturated),
 *   - `bg-black/*`, `bg-white/5…40` (translucent overlays on dark chrome) —
 *     a low-alpha surface is a veil, a high-alpha one is a tile and IS in scope.
 */
function rendersLight(token: string): boolean {
  const exact = stripAlpha(baseToken(token));
  if (/^(bg|from|via|to)-(white|cream)$/.test(exact)) return isOpaqueEnough(token);
  if (new RegExp(`^(bg|from|via|to)-(${NEUTRALS}|${ACCENTS})-${LIGHT_TINT}$`).test(exact)) {
    return isOpaqueEnough(token);
  }
  if (new RegExp(`^text-(${NEUTRALS})-(500|600|700|800|900|950)$`).test(exact)) return true;
  if (new RegExp(`^text-(${ACCENTS})-(700|800|900|950)$`).test(exact)) return true;
  if (new RegExp(`^border-(${NEUTRALS})-${LIGHT_TINT}$`).test(exact)) return true;
  if (new RegExp(`^divide-(${NEUTRALS})-(50|100|200)$`).test(exact)) return true;
  if (new RegExp(`^ring-(${NEUTRALS})-(200|300)$`).test(exact)) return true;
  if (new RegExp(`^ring-(${ACCENTS})-${LIGHT_TINT}$`).test(exact)) return true;
  return false;
}

/**
 * Tokens that render light and are NOT remapped, on purpose.
 *
 * Every entry needs a reason. The admin console is dark in both themes, so its
 * light hairlines sit on a dark panel there too; a translucent white overlay on
 * a hero must stay translucent white in both themes.
 */
const EXCUSED = new Map<string, string>([
  // ── The hero/CTA sections are dark in both themes by design ──────────────
  ['border-white', 'translucent white hairline on always-dark chrome'],
  ['ring-white', 'focus/ring on always-dark chrome'],

  // ── Gradient stops that must stay BRIGHT ────────────────────────────────
  [
    'to-teal-300',
    'gradient TEXT stop (`from-emerald-400 to-teal-300 bg-clip-text`) — these headings are bright on purpose; darkening the stop would make the text unreadable on dark',
  ],
  [
    'from-slate-300',
    'silver (rank 2) medal chip in ContestDetailPage — a medal must stay silver in both themes',
  ],
  [
    'from-orange-300',
    'bronze (rank 3) medal chip in ContestDetailPage — bright on purpose, pairs with to-orange-500',
  ],
  // ── Accent borders/rings at 300 are colour accents, not surfaces: they are
  //    mid-tone on their own and read as the intended hue on dark. ─────────
  ['border-amber-300', 'amber accent hairline — mid-tone, not a surface'],
  ['border-blue-300', 'blue accent hairline — mid-tone, not a surface'],
  ['border-emerald-300', 'emerald accent hairline — mid-tone, not a surface'],
  ['border-fuchsia-300', 'fuchsia accent hairline — mid-tone, not a surface'],
  ['border-orange-300', 'orange accent hairline — mid-tone, not a surface'],
  ['border-red-300', 'red accent hairline — mid-tone, not a surface'],
  ['border-violet-300', 'violet accent hairline — mid-tone, not a surface'],
  ['placeholder-slate-600', 'placeholder text on the always-dark admin console'],
  ['placeholder-white/50', 'placeholder on the always-dark hero search field'],

  // ── The admin console is dark in BOTH themes ────────────────────────────
  ['bg-slate-800', 'admin console panel — dark in both themes'],
  ['bg-slate-900', 'admin console shell — dark in both themes'],
  ['bg-slate-700', 'admin avatar/placeholder fill — dark in both themes'],
  ['text-slate-300', 'admin console body text — already light'],
  ['border-slate-700', 'admin console hairline — already dark'],
  ['border-slate-800', 'admin console hairline — already dark'],
  ['divide-slate-800', 'admin console table rule — already dark'],
  ['text-slate-400', 'muted text that is already light enough on dark'],
]);

// ── 4. The assertions ───────────────────────────────────────────────────────
const inScope = USED.filter((t) => rendersLight(t) && !EXCUSED.has(t));

describe('dark theme — every light-surface utility is accounted for', () => {
  it('parses the remap (a broken parse must not pass the next assertion)', () => {
    // If globals.css is restructured so this regex stops matching, COVERED would
    // be empty and every page would "fail" — or, worse, a future trim to zero
    // selectors would pass vacuously. Pin a floor.
    expect(COVERED.size).toBeGreaterThan(80);
    expect([...COVERED]).toContain('bg-white');
    expect([...COVERED]).toContain('bg-slate-50');
    expect([...COVERED]).toContain('text-slate-900');
    // State variants must be parsed WITH their prefix — that is the only way
    // the hover defect below is visible to this file at all.
    expect([...COVERED]).toContain('hover:bg-slate-50');
  });

  it('found colour utilities to check (the scan itself is not vacuous)', () => {
    expect(inScope.length).toBeGreaterThan(20);
  });

  it('remaps or excuses every light-rendering utility used in src/', () => {
    const unaccounted = inScope.filter((t) => !COVERED.has(t));
    const report = unaccounted
      .map((t) => `  ${t.padEnd(26)} ${[...usedTokens.get(t)!].slice(0, 3).join(', ')}`)
      .join('\n');
    expect(
      unaccounted,
      `These paint a light surface in dark mode. Add each to the .dark :where(...) remap ` +
        `in src/styles/globals.css — or to EXCUSED in this test with a reason:\n${report}`
    ).toEqual([]);
  });

  it('carries no stale excuse', () => {
    const stale = [...EXCUSED.keys()].filter((t) => !usedTokens.has(baseToken(t)) && !usedTokens.has(t));
    expect(stale, `EXCUSED entries nothing uses any more: ${stale.join(', ')}`).toEqual([]);
  });

  it('has one boot splash, and it is the light one', () => {
    // Light-only now: the splash no longer needs a dark twin, and a leftover
    // `html.dark #boot-overlay` rule would be a stale copy of a removed theme.
    //
    // The splash lives in scripts/build.mjs, NOT vite.config.ts. A closeBundle
    // plugin in vite.config ran before Vike wrote its HTML, so every build
    // shipped zero splashes and SPA-fallback routes hydrated the homepage DOM
    // (React #418 on four audited routes, measured 2026-11-22). The build now
    // inspects the final dist/index.html for `__boot_splash_marker__` and
    // fails if it is missing, so this cannot silently regress again.
    const build = readRepo('scripts/build.mjs');
    expect(build).toContain('#boot-overlay');
    expect(build).toContain('__boot_splash_marker__');
    expect(build).not.toMatch(/html\.dark\s+#boot-overlay/);
    expect(readRepo('vite.config.ts')).not.toContain('bootSplashInjectPlugin');
  });

  it('carries no excuse that the remap already handles', () => {
    // An excused token that IS remapped means the remap would be overridden by
    // the excuse's premise — one of the two is wrong.
    const redundant = [...EXCUSED.keys()].filter((t) => COVERED.has(t));
    expect(redundant, `already remapped in globals.css: ${redundant.join(', ')}`).toEqual([]);
  });
});

/**
 * The specificity trap that made dark-mode hovers look broken.
 *
 * `.dark :where(.hover\:bg-slate-50:hover)` has specificity (0,1,0) — `:where()`
 * zeroes its whole argument, pseudo-class included — while Tailwind's own
 * `.hover\:bg-slate-50:hover` is (0,2,0) and wins. The remap existed, looked
 * right in review, and did nothing: every button, row and nav item flashed
 * #f8fafc on hover in dark mode. The state pseudo therefore lives OUTSIDE
 * `:where()`, which ties Tailwind and wins on source order.
 */
describe('dark theme — state remaps keep a winning shape', () => {
  /**
   * Comments describe these very rules (and contain braces), so every scan in
   * this block runs against a comment-blanked copy: equal length, same offsets,
   * no self-matching and no unbalanced braces from prose.
   */
  const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const statePseudo = /:(hover|focus|focus-visible|focus-within|active|disabled|checked)\b/;
  /** Only Tailwind utility classes compile with an escaped `\:` (variant prefix). */
  const isUtilityClass = (selector: string) => /\\:/.test(selector);
  const remapBlocks = [...CSS.matchAll(/\.dark[^{}]*\{([^}]*)\}/g)].map((m) => m[0]);

  it('found remap blocks to inspect (not vacuously green)', () => {
    expect(remapBlocks.length).toBeGreaterThan(80);
    expect(remapBlocks.some((b) => b.includes('hover'))).toBe(true);
  });

  it('never puts a state pseudo-class inside :where()', () => {
    // Component classes (`.btn-secondary`) live in the components layer, where a
    // utilities-layer remap wins on LAYER ORDER no matter the specificity — only
    // Tailwind's own utility rules compete inside the same layer.
    const offenders = [...CSS.matchAll(/\.dark[^{}]*?:where\(([^)]*)\)[^{}]*?\{/g)]
      .map((m) => m[1])
      .filter((args) => statePseudo.test(args) && isUtilityClass(args));
    expect(
      offenders,
      `A state pseudo inside :where() is zeroed by :where, so Tailwind's own (0,2,0) ` +
        `rule wins and the remap is dead code. Move the pseudo outside the :where(...):\n` +
        offenders.map((s) => `  :where(${s})`).join('\n')
    ).toEqual([]);
  });

  it('proves the shape matters — an html.dark remap wins the cascade tie', () => {
    const ruleAt = CSS.indexOf('html.dark :where(.hover\\:bg-slate-50):hover');
    expect(ruleAt, 'the hover surface remap is missing or lost its specificity prefix').toBeGreaterThan(-1);
    // The pseudo must be OUTSIDE this `:where()`: inside it the rule drops to
    // (0,1,0) and Tailwind's own (0,2,0) `hover:` utility wins outright.
    expect(CSS.slice(ruleAt, ruleAt + 70)).not.toContain(':hover)');
  });

  it('keeps every state remap OUT of @layer utilities', () => {
    // Inside the layer Tailwind (a) emits its generated variant utilities after
    // user content, so equal specificity loses on source order, and (b) folds
    // the state pseudo back into `:where(...)`. Both were measured in the live
    // stylesheet. Outside the layer the block is emitted verbatim and last.
    const spans: { from: number; to: number }[] = [];
    let cursor = 0;
    while ((cursor = CODE.indexOf('@layer', cursor)) !== -1) {
      const open = CODE.indexOf('{', cursor);
      if (open === -1) break;
      let depth = 0;
      let end = -1;
      for (let i = open; i < CODE.length; i++) {
        if (CODE[i] === '{') depth++;
        else if (CODE[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end !== -1) spans.push({ from: cursor, to: end });
      cursor = end === -1 ? CODE.length : end + 1;
    }
    expect(spans.length, 'no @layer block found — the parser would pass vacuously').toBeGreaterThan(0);

    const stateRules = [...CODE.matchAll(/([^\n{}]*:where\([^)]*\)[^{}]*)\{/g)]
      .filter((m) => /:(hover|focus|focus-visible|active|disabled|group-hover)\b/.test(m[0]))
      // Only Tailwind utility classes compile with an escaped `:`; the
      // design-system `.btn-secondary` rules live in the components layer, which
      // a utilities-layer remap beats on LAYER order regardless of specificity.
      .filter((m) => /\\:/.test(m[1]))
      .map((m) => ({ index: m.index ?? 0, selector: m[1].trim() }));
    expect(stateRules.length, 'no state remap rules found (vacuous)').toBeGreaterThan(10);

    const inside = stateRules.filter((r) => spans.some((s) => r.index > s.from && r.index < s.to));
    expect(
      inside.map((r) => r.selector),
      'State remaps inside @layer utilities lose to Tailwind\'s generated variant utilities'
    ).toEqual([]);

    const unprefixed = stateRules.filter((r) => !r.selector.startsWith('html.dark'));
    expect(
      unprefixed.map((r) => r.selector),
      'Every state remap needs the `html.dark` prefix so it out-specifies Tailwind\'s (0,2,0) rule'
    ).toEqual([]);
  });

  it('covers the exact hover tokens that used to flash white', () => {
    for (const token of ['hover:bg-slate-50', 'hover:bg-white', 'focus:bg-white', 'active:bg-slate-100']) {
      expect([...COVERED]).toContain(token);
    }
  });
});

/**
 * Hardcoded near-white surfaces are invisible to the palette remap: Tailwind
 * emits `bg-[#F8FAFC]` as a literal colour, so a page shell written that way
 * stayed bright in dark mode no matter what the remap said. `bg-[#F8FAFC]` is
 * exactly Tailwind's `slate-50`, so the fix is to spell it as the token.
 */
describe('dark theme — no hardcoded near-white surfaces', () => {
  const luminance = (hex: string) => {
    const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };

  const arbitrary = new Map<string, Set<string>>();
  for (const file of sourceFiles(SRC)) {
    // This file names the offending hex on purpose; it never renders.
    if (stroke(path.relative(SRC, file)).startsWith('test/')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/bg-\[(#[0-9a-fA-F]{3,8})\]/g)) {
      if (!arbitrary.has(m[1].toLowerCase())) arbitrary.set(m[1].toLowerCase(), new Set());
      arbitrary.get(m[1].toLowerCase())!.add(stroke(path.relative(SRC, file)));
    }
  }

  it('scanned arbitrary backgrounds (not vacuously green)', () => {
    expect(arbitrary.size).toBeGreaterThan(0);
  });

  it('keeps every arbitrary background dark enough for a dark theme', () => {
    const bright = [...arbitrary]
      .filter(([hex]) => /^#[0-9a-f]{6}$/.test(hex) && luminance(hex) > 0.5)
      .map(([hex, files]) => `  ${hex}  ${[...files].slice(0, 3).join(', ')}`);
    expect(
      bright,
      `These hardcode a light background that no palette remap can reach. Use the ` +
        `Tailwind token instead (bg-[#F8FAFC] is bg-slate-50):\n${bright.join('\n')}`
    ).toEqual([]);
  });
});

/**
 * The theme guard that runs BEFORE React.
 *
 * It has exactly one definition (scripts/build.mjs) and is injected into every
 * page Vike emits plus the from-scratch SPA-fallback shell. It used to live in
 * vite.config.ts too, injected from a closeBundle plugin — that hook runs
 * BEFORE Vike writes its HTML, so both copies disappeared from the shipped
 * pages and nothing failed (measured 2026-11-22: 0 markers in dist/index.html).
 */
describe('theme FOUC guard — one definition, injected at build time', () => {
  const MARKER = '<!-- __theme_guard_marker__ -->';
  const guardIn = (relative: string) => {
    const text = readRepo(relative);
    const at = text.indexOf(MARKER);
    if (at === -1) throw new Error(`no theme guard found in ${relative}`);
    return text.slice(at, text.indexOf('</script>', at) + '</script>'.length);
  };

  const buildGuard = guardIn('scripts/build.mjs');

  it('has exactly one definition — the one that runs after Vike writes HTML', () => {
    expect(readRepo('vite.config.ts')).not.toContain('__theme_guard_marker__');
    expect(readRepo('scripts/build.mjs')).toContain('injectPreHydrationGuards');
  });

  it('pins the site to light on every route — the site is light-only now', () => {
    for (const guard of [buildGuard]) {
      // A stale `.dark` class (older build, saved preference) must be removed
      // before CSS paints, or a returning visitor sees a dark, half-themed page.
      expect(guard).toContain("root.classList.remove('dark')");
      expect(guard).not.toContain("classList.add('dark')");
      // `color-scheme` is what makes native scrollbars/controls render light.
      expect(guard).toContain("root.style.colorScheme = 'light'");
      // The retired preference is deleted, never read back.
      expect(guard).toContain("localStorage.removeItem('growlancer-theme')");
      expect(guard).not.toContain('prefers-color-scheme');
      // A blocked localStorage (private mode) must not throw during boot.
      expect(guard).toMatch(/try \{[\s\S]*\} catch \(e\) \{/);
    }
  });

  it('is injected into <head>, before anything paints', () => {
    // The injector must target </head>, not </body>: a `<script>` at the end of
    // the body runs after the browser may already have painted the cream body.
    expect(readRepo('scripts/build.mjs')).toMatch(/replace\('<\/head>', `\$\{THEME_FOUC_GUARD\}/);
  });

  it('is not duplicated back into index.html, which nothing serves', () => {
    // index.html is not the document Vike emits (measured: the built HTML has
    // none of its markers), so a guard living there is dead code that only
    // creates a second copy to drift.
    expect(readRepo('index.html')).not.toContain('growlancer-theme');
  });
});
