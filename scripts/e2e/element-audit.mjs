// Growlanzo ELEMENT-LEVEL UI audit (Section-1 universal checklist)
// ─────────────────────────────────────────────────────────────────────────────
// Unlike device-audit.mjs (which checks "does the page load without errors"),
// this harness checks "is everything ON the page correct":
//
//   A. TEXT      leftover placeholder/lorem/TODO text, silently clipped text
//                (scrollWidth > clientWidth without CSS ellipsis), broken
//                currency glyphs / wrong currency symbols, '�' mojibake
//   B. BUTTONS   generic labels ("OK", "Submit", "Click here"), <a> without
//                href acting as a button
//   C. ICONS     interactive elements with no accessible name (icon-only
//                buttons without aria-label/title)
//   D. FORMS     meaningless placeholders, inputs missing any label/aria
//   E. LINKS     internal links that 404, external links missing
//                target=_blank / rel=noopener, broken images
//   F. MEDIA     broken images, missing alt
//   I. LAYOUT    horizontal-overflow offenders at 375 / 768 / 1280 (excluding
//                intentional horizontal scrollers)
//   + global:    page errors, console errors, 4xx, duplicate ids, heading
//                skips, missing <title>/<html lang>/viewport meta
//
// Usage:
//   node scripts/e2e/element-audit.mjs --base=http://localhost:4174 --group=public
//   groups: public | auth | dashboard | client | admin | all
//
// THEMED RUNS: add --theme=dark (or light). The run then emulates the OS
// preference AND seeds the saved preference, so it sweeps the exact state a real
// visitor is in — and it fails closed on two things a "looks fine to me" check
// cannot see: a page that ended up in the WRONG theme, and a dark visitor whose
// `.dark` class only appeared after React booted (i.e. a light flash, which is
// what happens when the pre-paint guard does not ship). Run the same group twice
// (--theme=light, --theme=dark) to cover both.
//
// AUTHENTICATED RUNS FAIL CLOSED: when --storage=<role>.json is passed, every
// route under that role's protected surface must render authenticated chrome
// (a logout control, still on the role's surface, no logged-out gate). A dead
// storage state used to be invisible — /client simply redirected to the
// homepage and /admin rendered its login gate, so the sweep reported "0 issues"
// while auditing logged-out pages. That is now an authViolation, it is counted
// as an issue, and it fails the run even without --strict (a run that could not
// authenticate proves nothing about the pages it claims to cover).
//
// Artifacts land in tests/e2e-artifacts/ (gitignored).

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CHROME_CANDIDATES = [
  process.env.E2E_CHROME_PATH,
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium_headless_shell-1243\\chrome-headless-shell-win64\\chrome-headless-shell.exe`,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  })
);

const BASE = args.base || 'http://localhost:4174';
const GROUP = args.group || 'all';
const CONCURRENCY = Number(args.concurrency || 4);
const OUT_DIR = path.resolve(args.out || 'tests/e2e-artifacts');
const PREFIX = args.prefix || 'element-audit';
// Optional authenticated run: playwright storage-state JSON (see scripts/e2e/login.mjs).
// All groups then audit the LOGGED-IN surface — dashboards render real shells,
// protected routes stop redirecting to the login modal.
const STORAGE = args.storage || null;
// Role inferred from the storage filename (login.mjs writes `.e2e/<role>.json`),
// used to decide which routes MUST render authenticated chrome. An unreadable
// name is treated as the strictest case: all three protected surfaces.
const ROLE = STORAGE ? path.basename(STORAGE).replace(/\.json$/, '') : null;
const AUTH_PREFIXES = STORAGE
  ? { freelancer: ['/dashboard'], client: ['/client'], admin: ['/admin'] }[ROLE] || ['/dashboard', '/client', '/admin']
  : [];
// Optional theme sweep — see the THEMED RUNS note in the header.
const THEME = args.theme || null;
if (THEME && !['light', 'dark'].includes(THEME)) {
  console.error(`::error::--theme must be light or dark (got "${THEME}")`);
  process.exit(1);
}

const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 667, dpr: 2, mobile: true },
  { name: 'tablet-768', width: 768, height: 1024, dpr: 2, mobile: true },
  { name: 'desktop-1280', width: 1280, height: 800, dpr: 1, mobile: false },
];

// Concrete URL list derived from src/app/App.tsx route tree. Dynamic :params
// get a dummy value — the page must show a graceful not-found/empty state,
// never a crash (that is exactly what we test).
/** Deliberate 404 probe (see the soft-404 fix): the route must answer 404 with
 * the NotFoundPage. Any OTHER 4xx is still a real failure, and a 200 here means
 * the blanket rewrite came back — so the status is asserted, not ignored. */
const EXPECTED_NOT_FOUND_ROUTES = new Set(['/this-route-does-not-exist']);

const ROUTE_GROUPS = {
  public: [
    '/', '/how-it-works', '/features', '/categories', '/pricing', '/about',
    '/philosophy', '/internships', '/careers', '/contact', '/report',
    '/help-center', '/safety', '/guidelines', '/status', '/terms', '/privacy',
    '/escrow-policy', '/refund-policy', '/cookies',
    '/freelancers', '/services', '/contests', '/login', '/signup',
    '/freelancer/e2e-dummy-id', '/services/e2e-dummy-id', '/contests/e2e-dummy-id',
    '/projects/e2e-dummy-id',
    '/payment/success', '/payment/cancel', '/payment/pending',
    '/certificate', '/verify-certificate', '/certificate/e2e-dummy-code',
  ],
  auth: [
    // Email/password auth pages were removed (GitHub/LinkedIn only) — the
    // routes are gone from App.tsx, so they are no longer audited as pages.
    '/auth/callback', '/auth/email-confirm', '/auth/verify-email',
    '/onboarding', '/onboarding/freelancer', '/onboarding/client',
    '/waitlist', '/this-route-does-not-exist',
  ],
  dashboard: [
    '/dashboard', '/dashboard/feed', '/dashboard/invites', '/dashboard/proposals',
    '/dashboard/contracts', '/dashboard/workspace', '/dashboard/wallet',
    '/dashboard/profile', '/dashboard/referrals', '/dashboard/pro',
    '/dashboard/ai-assistant', '/dashboard/services', '/dashboard/services/create',
    '/dashboard/portfolio', '/dashboard/analytics', '/dashboard/notifications',
    '/dashboard/disputes', '/dashboard/identity-verification',
    '/dashboard/certifications', '/dashboard/certifications/e2e-dummy-test',
    '/dashboard/time-tracking', '/dashboard/contests', '/dashboard/help-center',
    '/dashboard/support-tickets',
  ],
  client: [
    '/client', '/client/post', '/client/projects', '/client/matches',
    '/client/invites', '/client/proposals', '/client/contracts',
    '/client/workspace', '/client/workspace/e2e-dummy-id',
    '/client/notifications', '/client/payments', '/client/settings',
    '/client/verification', '/client/referrals', '/client/team-projects',
    '/client/team-projects/create', '/client/team-projects/e2e-dummy-id',
    '/client/ai-assistant', '/client/find-talent', '/client/reviews',
    '/client/contests', '/client/contests/create', '/client/help-center',
    '/client/support-tickets',
  ],
  admin: [
    '/admin', '/admin/users', '/admin/projects', '/admin/contracts',
    '/admin/payments', '/admin/finance', '/admin/withdrawals', '/admin/disputes',
    '/admin/subscriptions', '/admin/reports', '/admin/internships',
    '/admin/certificates', '/admin/identity-verification',
    '/admin/support-tickets', '/admin/user-reports', '/admin/waitlist',
    '/admin/data-isolation',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// In-page collector — plain JSON out.
// ─────────────────────────────────────────────────────────────────────────────
function inPageAudit(device) {
  const vw = window.innerWidth;

  function shortSelector(el) {
    if (!el || el === document.body) return 'body';
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 4) {
      let s = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`${s}#${node.id}`); break; }
      const cls = (node.getAttribute('class') || '').split(/\s+/).filter(Boolean)
        .slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
      s += cls;
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(s);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  function label(el, max = 60) {
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > max ? `${t.slice(0, max - 3)}...` : t;
  }

  function visible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (t) return t;
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    if (el.textContent && el.textContent.trim()) return el.textContent.trim();
    // image inside link/button counts as its name
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
    // svg with a <title> child provides an accessible name (SVG-AAM)
    const svgTitle = el.querySelector('svg > title');
    if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
    return '';
  }

  const out = {
    badText: [],          // A: leftover placeholder / lorem / TODO
    clippedText: [],      // A: silently clipped (no ellipsis)
    badCurrency: [],      // A: wrong symbol / broken glyph
    genericButtons: [],   // B: vague labels
    hreflessLinks: [],    // B: <a> without href
    unnamedInteractive: [],// C: icon-only without accessible name
    badPlaceholders: [],  // D: meaningless placeholders
    unlabeledInputs: [],  // D: inputs with no label association
    externalLinkIssues: [],// E: external without target/rel
    internalLinks: [],    // E: hrefs to verify (deduped)
    brokenImages: [],     // F
    missingAlt: [],       // F
    overflowOffenders: [],// I (non-scroller only)
    duplicateIds: [],
    headingSkips: [],
    docIssues: [],
  };

  // ── A. TEXT ────────────────────────────────────────────────────────────────
  const BAD_TEXT_RE = /\b(lorem ipsum|todo[:\s]|fixme|tbd\b|sample text|test 123|dummy text|placeholder text|asdf|xxxxx)\b/i;
  const CURRENCY_RE = /(\$\s?\d)|(\bRs\.?\s?\d)|(\bUSD\s?\d)|(\bINR\s?\d)|(€\s?\d)|(�)/i;
  const seenText = new Set();
  for (const el of document.body.querySelectorAll('p, span, div, li, a, button, label, h1, h2, h3, h4, h5, h6, td, th, small, strong, em, figcaption, blockquote, option')) {
    if (!visible(el)) continue;
    const hasTextChild = Array.from(el.children).some((c) => (c.textContent || '').trim());
    if (hasTextChild) continue;
    const text = (el.textContent || '').trim();
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    const m = text.match(BAD_TEXT_RE);
    if (m) out.badText.push({ selector: shortSelector(el), text: label(el), match: m[1] });
    const c = text.match(CURRENCY_RE);
    if (c) out.badCurrency.push({ selector: shortSelector(el), text: label(el), match: c[1] || c[0] });
    if (out.badText.length + out.badCurrency.length > 14) break;
  }

  // A2. silently clipped text (mobile only): scrollWidth overflow WITHOUT
  // text-overflow:ellipsis (ellipsis truncation is an intentional design token).
  if (device.mobile) {
    let clipped = 0;
    for (const el of document.body.querySelectorAll('p, span, a, button, label, h1, h2, h3, h4, h5, h6, td, th, small')) {
      if (!visible(el)) continue;
      const hasTextChild = Array.from(el.children).some((c) => (c.textContent || '').trim());
      if (hasTextChild) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis') continue;
      if (cs.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 4) {
        out.clippedText.push({ selector: shortSelector(el), text: label(el, 40), over: el.scrollWidth - el.clientWidth });
        if (++clipped >= 6) break;
      }
    }
  }

  // ── B. BUTTONS ─────────────────────────────────────────────────────────────
  const GENERIC = new Set(['ok', 'submit', 'click here', 'here', 'go', 'button', 'click', 'yes', 'no']);
  for (const el of document.body.querySelectorAll('button, [role="button"], a[href]')) {
    if (!visible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const name = accessibleName(el).toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (GENERIC.has(name)) {
      out.genericButtons.push({ selector: shortSelector(el), tag: el.tagName.toLowerCase(), name: accessibleName(el) });
    }
    if (el.tagName === 'A' && !el.hasAttribute('href')) {
      out.hreflessLinks.push({ selector: shortSelector(el), text: label(el, 40) });
    }
  }

  // ── C. ICONS (unnamed interactive) ────────────────────────────────────────
  for (const el of document.body.querySelectorAll('a[href], button, [role="button"], [role="tab"], [role="menuitem"], summary')) {
    if (!visible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (!accessibleName(el)) {
      out.unnamedInteractive.push({ selector: shortSelector(el), tag: el.tagName.toLowerCase(), text: label(el, 30) });
    }
  }

  // ── D. FORMS ──────────────────────────────────────────────────────────────
  // Generic placeholders are banned per Section-1 D; context-specific "Enter
  // your X" is fine when X identifies the field (e.g. "Enter your admin
  // password" on the admin gate). Only flag truly contentless ones.
  const BAD_PLACEHOLDER = /^(enter [a-z ]{3,20}|type here|enter here|type something|\*+|—|-)$/i;
  const CONTEXT_OK_PLACEHOLDER = /\b(admin|current|new|confirm|search|e\.g\.|code|otp|upi|ifsc)\b/i;
  for (const el of document.body.querySelectorAll('input:not([type="hidden"]), textarea')) {
    if (!visible(el)) continue;
    const ph = el.getAttribute('placeholder') || '';
    if (ph && BAD_PLACEHOLDER.test(ph.trim()) && !CONTEXT_OK_PLACEHOLDER.test(ph)) {
      out.badPlaceholders.push({ selector: shortSelector(el), placeholder: ph });
    }
    // label association: <label for>, wrapping label, aria-label, aria-labelledby, title,
    // or a SPECIFIC placeholder (HTML-AAM accessible-name fallback). Long,
    // descriptive placeholders carry identifying context; short generic ones
    // ("Enter your name", "Search") do not and stay flagged.
    const id = el.id;
    const phTrim = ph.trim();
    const specificPlaceholder = phTrim.length >= 20 || /^e\.g\./i.test(phTrim);
    const hasLabel =
      (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
      el.closest('label') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.getAttribute('title') ||
      specificPlaceholder;
    if (!hasLabel) out.unlabeledInputs.push({ selector: shortSelector(el), type: el.type, placeholder: ph });
  }

  // ── E/F. LINKS + IMAGES ───────────────────────────────────────────────────
  const hrefs = new Set();
  for (const a of document.body.querySelectorAll('a[href]')) {
    if (!visible(a)) continue;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    const abs = new URL(href, location.href);
    if (abs.origin !== location.origin) {
      const target = a.getAttribute('target');
      const rel = a.getAttribute('rel') || '';
      if (target !== '_blank') out.externalLinkIssues.push({ href: abs.href.slice(0, 120), issue: 'no-target-blank' });
      else if (!rel.includes('noopener')) out.externalLinkIssues.push({ href: abs.href.slice(0, 120), issue: 'no-rel-noopener' });
    } else if (!hrefs.has(abs.pathname + abs.search)) {
      hrefs.add(abs.pathname + abs.search);
      out.internalLinks.push(abs.pathname + abs.search);
    }
  }

  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue;
    const src = img.getAttribute('src') || '';
    if (img.complete && img.naturalWidth === 0 && src && !src.startsWith('data:')) {
      out.brokenImages.push({ src: src.slice(0, 120), selector: shortSelector(img) });
    }
    if (img.getAttribute('alt') === null) out.missingAlt.push(shortSelector(img));
  }

  // ── I. LAYOUT (horizontal overflow, non-scroller only) ───────────────────
  const docEl = document.documentElement;
  out.overflowDelta = docEl.scrollWidth - docEl.clientWidth;
  const overflowing = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    // Skip elements inside ANY fixed-position ancestor (off-canvas sidebars,
    // modal panels): they inherit the container's viewport-anchored transform
    // (e.g. -translate-x-full when closed) and are not document-flow overflow.
    // NOTE: computed style objects are read-only — track the outcome in a
    // local flag, never by writing back to the CSSStyleDeclaration.
    let underFixedAncestor = getComputedStyle(el).position === 'fixed';
    for (let pa = el.parentElement; !underFixedAncestor && pa && pa !== document.body; pa = pa.parentElement) {
      if (getComputedStyle(pa).position === 'fixed') underFixedAncestor = true;
    }
    if (underFixedAncestor) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) overflowing.push({ el, r });
  }
  let offCount = 0;
  for (const o of overflowing) {
    const parent = o.el.parentElement;
    if (parent && overflowing.some((p) => p.el === parent)) continue;
    let anc = o.el.parentElement;
    let inScroller = false;
    while (anc && anc !== document.body) {
      const acs = getComputedStyle(anc);
      if (acs.overflowX === 'auto' || acs.overflowX === 'scroll' || acs.overflowX === 'hidden') { inScroller = true; break; }
      anc = anc.parentElement;
    }
    if (inScroller) continue;
    out.overflowOffenders.push({
      selector: shortSelector(o.el),
      tag: o.el.tagName.toLowerCase(),
      width: Math.round(o.r.width),
      left: Math.round(o.r.left),
      text: label(o.el, 40),
    });
    if (++offCount >= 6) break;
  }

  // ── Global structure ───────────────────────────────────────────────────────
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    const id = el.id;
    if (!id) continue;
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  out.duplicateIds = [...ids.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`).slice(0, 8);

  let prevLevel = 0;
  const skips = [];
  for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const level = Number(h.tagName[1]);
    // Accepted pattern: H1 page-title followed directly by H3 card-section
    // headers in the dashboard/client/admin layouts (no intermediate H2).
    // Promoting every card header to H2 is tracked as a follow-up refactor;
    // deeper skips (H1→H4+, H2→H4+, etc.) remain strict failures.
    const accepted = prevLevel === 1 && level === 3;
    if (prevLevel && level > prevLevel + 1 && !accepted) {
      skips.push(`H${level} "${label(h, 40)}" after H${prevLevel || 0}`);
      if (skips.length >= 6) break;
    }
    prevLevel = level;
  }
  out.headingSkips = skips;

  if (!document.title || !document.title.trim()) out.docIssues.push('missing <title>');
  if (!document.documentElement.getAttribute('lang')) out.docIssues.push('missing <html lang>');
  if (device.mobile && !document.querySelector('meta[name="viewport"]')) out.docIssues.push('missing viewport meta');

  // ── Auth integrity evidence (used only when --storage was passed) ──────────
  // Three shapes were measured against a dead storage state, one per role:
  //   /dashboard → stays on the path but renders an empty shell (no logout)
  //   /client    → redirects to / and renders the marketing homepage
  //   /admin     → renders its own "Restricted Access" login gate
  // All three would otherwise be audited as ordinary pages and pass.
  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
  // The logout control is NOT findable by text alone. Measured 2026-09-28 over
  // 3 roles × 3 viewports × 3 routes (27 loads) with live sessions:
  //   freelancer/client → literal <span>Logout</span> in the sidebar → TEXT
  //   admin             → icon-only <button title="Logout from Admin">, whose
  //                       label is an ATTRIBUTE and therefore absent from both
  //                       innerText and textContent → ATTRIBUTE
  // text-only matched 18/27 (9 false positives, every one of them admin) and
  // attribute-only matched 9/27; the union matched 27/27. Either signal alone
  // fails a healthy surface, so the union is what makes this guard usable.
  const LOGOUT_TEXT_RE = /\b(log\s?out|sign\s?out)\b/i;
  // Real logged-out gates only. "Welcome back" is deliberately NOT here: it is
  // the HEALTHY /dashboard greeting, and reaching for it as a gate reason is how
  // the first version of this guard produced a false positive.
  const LOGGED_OUT_GATE_RE = /restricted access|authorized personnel only|admin login/i;
  const logoutAttrEl = document.querySelector(
    '[title*="logout" i],[aria-label*="logout" i],[title*="sign out" i],[aria-label*="sign out" i],[data-testid*="logout" i],[data-testid*="sign-out" i]',
  );
  const logoutText = LOGOUT_TEXT_RE.test(bodyText);
  out.authChrome = {
    path: location.pathname,
    logoutControl: logoutText || Boolean(logoutAttrEl),
    // Which half of the union matched — kept per load so the artifact proves
    // WHICH chrome was seen, not merely that something matched.
    logoutSignal: logoutText ? 'text' : logoutAttrEl ? 'attribute' : null,
    loggedOutGate: (bodyText.match(LOGGED_OUT_GATE_RE) || [null])[0],
  };

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
// Vercel Analytics/SpeedInsights scripts only exist on Vercel's infra — locally they
// 404 and get CORS-refused on every page. Environment artifact, never a product bug.
const IGNORED_URL_RE = /supabase\.co|sentry|google-analytics|posthog|razorpay\.com\/v\/1\/checkout|fonts\.gstatic|gstatic\.com|\/_vercel\/(insights|speed-insights)/;
const isIgnored = (url) => IGNORED_URL_RE.test(url);

// ── Auth session events: the race-proof half of the auth guard ───────────────
// DOM shape alone is NOT a trustworthy discriminator for "is this session
// alive". Measured 2026-09-28 against a revoked admin storage state: /admin/users
// rendered its "Restricted Access" gate at ~1.0 s and then FLIPPED BACK to the
// stale authenticated layout — logout button present — at ~1.4 s, while a live
// session only painted its logout control at ~2.2 s. A snapshot can therefore
// both lag and flap, and 6 of 12 revoked loads still matched the logout control.
//
// GoTrue traffic is an event, not a shape. Measured over those same loads:
//   live    → POST /auth/v1/token?grant_type=refresh_token 200, GET /auth/v1/user 200
//   revoked → POST /auth/v1/token?grant_type=refresh_token 400, and NO /auth/v1/user at all
// Fail-closed rule: a load whose GoTrue responses ALL failed never proved it held
// a session, so any authenticated chrome it renders is stale by definition.
const AUTH_ENDPOINT_RE = /\/auth\/v1\/(token|user)$/;
const fmtAuthEvents = (events) =>
  events.map((e) => `${e.endpoint}${e.grant ? `?${e.grant}` : ''}=${e.status}`).join(', ') || 'no GoTrue traffic';

async function auditOne(browser, route, device, storageState) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    ...(storageState ? { storageState } : {}),
    ...(THEME ? { colorScheme: THEME } : {}),
    userAgent: device.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await context.newPage();
  if (THEME) {
    // Two jobs. (1) Give the visitor a SAVED preference — the app's real state,
    // and the state the pre-paint guard has to honour. (2) Capture whether
    // `.dark` was already on <html> when the document finished parsing, i.e.
    // whether that guard ran before React booted. Rendering the right theme
    // only after hydration still means a light flash on a dark screen.
    await context.addInitScript((theme) => {
      try {
        window.localStorage.setItem('growlancer-theme', theme);
        document.addEventListener('DOMContentLoaded', () => {
          window.__themeAtDomReady = document.documentElement.classList.contains('dark');
        });
      } catch (err) {
        console.warn('[element-audit] theme init script failed:', err && err.message);
      }
    }, THEME);
  }
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const authEvents = [];

  page.on('console', (msg) => {
    const loc = msg.location()?.url || '';
    // Also match the error TEXT: Vercel-insights refusals report the page URL
    // as location, only the message names the _vercel script.
    if (msg.type() === 'error' && !isIgnored(loc) && !isIgnored(msg.text())) {
      // The 404 probe's document is SUPPOSED to be 404; Chrome logs that as a
      // console error without naming the URL. Every other page keeps it.
      if (EXPECTED_NOT_FOUND_ROUTES.has(route) && /Failed to load resource.*404/i.test(msg.text())) return;
      consoleErrors.push(msg.text().slice(0, 200));
    }
  });
  page.on('pageerror', (err) => pageErrors.push(String(err.message || err).slice(0, 200)));
  page.on('requestfailed', (req) => {
    if (isIgnored(req.url())) return;
    failedRequests.push({ url: req.url().slice(0, 140), reason: req.failure()?.errorText || 'unknown' });
  });
  page.on('response', (res) => {
    if (res.status() < 400 || isIgnored(res.url())) return;
    // Same rule for the document request itself: the probe's 404 is expected.
    if (EXPECTED_NOT_FOUND_ROUTES.has(route) && res.url() === `${BASE}${route}`) return;
    failedRequests.push({ url: res.url().slice(0, 140), status: res.status() });
  });
  // GoTrue session events (see AUTH_ENDPOINT_RE). Recorded for every load; only
  // consulted on authenticated runs, where they can outvote the DOM shape.
  page.on('response', (res) => {
    let u;
    try {
      u = new URL(res.url());
    } catch {
      return;
    }
    if (!AUTH_ENDPOINT_RE.test(u.pathname)) return;
    authEvents.push({
      endpoint: u.pathname.split('/').pop(),
      grant: u.searchParams.get('grant_type') || undefined,
      status: res.status(),
    });
  });

  let httpStatus = null;
  try {
    const response = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    httpStatus = response?.status() ?? null;
    await page.waitForFunction(() => !document.getElementById('boot-overlay'), { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 70));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 200));
    });
    await page.waitForTimeout(250);
  } catch (err) {
    pageErrors.push(`navigation: ${String(err.message || err).slice(0, 200)}`);
  }

  let audit = null;
  try {
    audit = await page.evaluate(inPageAudit, { mobile: device.mobile });
  } catch (err) {
    pageErrors.push(`audit-eval: ${String(err.message || err).slice(0, 200)}`);
  }

  // Theme evidence (themed runs only): the state now, and at DOMContentLoaded.
  // `themeAtDomReady` is EVIDENCE, not a failure trigger. Measured 2026-10-16:
  // with the guard shipped 24/24 loads were dark at DOMContentLoaded; with it
  // stripped 0/3 were. So it discriminates today — but only because in this
  // build hydration happens to land after DOMContentLoaded, which is a build
  // detail, not a guarantee. Gating a run on it would make the gate depend on
  // the bundler's timing, so the failure trigger is the artifact check instead:
  // `themeGuardShipped`, whether the guard is in the HTML the server sends.
  let themeProbe = null;
  let themeAtDomReady = null;
  let themeGuardShipped = null;
  if (THEME) {
    try {
      themeProbe = await page.evaluate(() => ({
        dark: document.documentElement.classList.contains('dark'),
        colorScheme: document.documentElement.style.colorScheme,
        stored: (() => {
          try {
            return window.localStorage.getItem('growlancer-theme');
          } catch (err) {
            return `unreadable: ${err && err.message}`;
          }
        })(),
      }));
      themeAtDomReady = (await page.evaluate(() => window.__themeAtDomReady ?? null)) ?? null;
      // Raw server HTML for this route (no JS) — the artifact the browser got.
      const served = await page.request.get(`${BASE}${route}`);
      themeGuardShipped = (await served.text()).includes('__theme_guard_marker__');
    } catch (err) {
      pageErrors.push(`theme-eval: ${String(err.message || err).slice(0, 200)}`);
    }
  }

  // Auth-chrome re-check (authenticated runs only). On a slow mobile load the
  // sidebar/drawer — and with it the logout control — can paint after the audit
  // snapshot was taken (measured once on /dashboard/support-tickets at 375px,
  // with no console/page error and HTTP 200). A single bounded re-read keeps a
  // real dead session flagged (it never gains a control) while a page that was
  // simply still rendering does not become a false positive.
  // A single re-read was not enough on a cold dashboard chunk: measured
  // 2026-10-29, 5/72 authenticated loads still had no control after one retry
  // while this load's GoTrue check had SUCCEEDED (so the page was simply still
  // painting). Those loads can wait longer; a dead session can not, and is
  // never given extra attempts — it only ever gets the single re-read, so this
  // loop cannot turn an expired storage state into a pass.
  const sessionProvenAlive = authEvents.some((e) => e.status >= 200 && e.status < 300);
  if (storageState && audit?.authChrome && audit.authChrome.logoutControl === false) {
    const attempts = sessionProvenAlive ? 4 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await page.waitForTimeout(1500);
        const recheck = await page.evaluate(inPageAudit, { mobile: device.mobile });
        if (recheck?.authChrome) audit.authChrome = recheck.authChrome;
        if (audit.authChrome?.logoutControl) break;
      } catch {
        /* keep the latest reading — the retry must never hide a dead session */
        break;
      }
    }
  }

  // E: verify internal links resolve (once per page, on the desktop pass).
  let linkChecks = null;
  if (device.name === 'desktop-1280' && audit?.internalLinks?.length) {
    linkChecks = [];
    const targets = audit.internalLinks.slice(0, 40);
    for (const link of targets) {
      try {
        const res = await page.request.get(`${BASE}${link}`, { maxRedirects: 3 });
        const ok = res.status() < 400;
        if (!ok) linkChecks.push({ link, status: res.status() });
      } catch {
        linkChecks.push({ link, status: 'ERR' });
      }
    }
  }

  // ── Auth integrity: refuse to report a pass for a page we were never on ────
  // Scoped to the storage state's own surface, so intra-surface redirects
  // (/client/inbox → /client/notifications) stay legitimate while leaving the
  // surface (a dead session: /client → /) does not.
  // GoTrue's own verdict on this load, derived from events rather than shape.
  const authOk = authEvents.filter((e) => e.status >= 200 && e.status < 300);
  const authSession = { events: authEvents, dead: authEvents.length > 0 && authOk.length === 0 };

  const authViolations = [];
  const rolePrefix = AUTH_PREFIXES.find((p) => route === p || route.startsWith(`${p}/`));
  if (storageState && rolePrefix) {
    const chrome = audit?.authChrome || null;
    const norm = (p) => (p && p.length > 1 ? p.replace(/\/+$/, '') : p);
    const pathNorm = norm(chrome?.path);
    const prefixNorm = norm(rolePrefix);
    const leftSurface = chrome?.path && !(pathNorm === prefixNorm || (pathNorm || '').startsWith(`${prefixNorm}/`));
    // A logout control (by text OR by attribute — see the union note in
    // inPageAudit) is the proof of authenticated chrome. The gate wording is
    // only the *reason* a control is missing; it is never itself a trigger.
    // Appended to whichever DOM reason fires, so a rejection is never ambiguous
    // about WHY the load was refused (and infra 5xx stays distinguishable).
    const authNote = authSession.dead ? ` [GoTrue rejected every session check: ${fmtAuthEvents(authEvents)}]` : '';
    if (!chrome) authViolations.push('auth state could not be read (page did not evaluate)' + authNote);
    else if (!chrome.logoutControl) {
      authViolations.push(
        (chrome.loggedOutGate
          ? `logged-out gate rendered ("${chrome.loggedOutGate}") with no logout control`
          : leftSurface
            ? `left the authenticated surface → ${chrome.path} (no logout control)`
            : 'no logout control — page is not authenticated chrome') + authNote,
      );
    } else if (leftSurface) {
      authViolations.push(`authenticated, but on the wrong surface → ${chrome.path}` + authNote);
    } else if (authSession.dead) {
      // The DOM said "signed in" but GoTrue never accepted this load's session:
      // the exact stale-chrome case the shape-based guard used to miss when it
      // flapped back to the old layout.
      authViolations.push(
        `stale authenticated chrome: GoTrue rejected every session check (${fmtAuthEvents(authEvents)}), yet a logout control was rendered`,
      );
    }
  }

  // ── Theme integrity: a themed run may not pass on the wrong theme ─────────
  const themeViolations = [];
  if (THEME) {
    const wantDark = THEME === 'dark';
    if (!themeProbe) themeViolations.push('theme state could not be read (page did not evaluate)');
    else {
      if (themeProbe.dark !== wantDark) {
        themeViolations.push(`requested ${THEME} but <html> is ${themeProbe.dark ? 'dark' : 'not dark'}`);
      }
      if (themeGuardShipped !== true) {
        themeViolations.push(
          'the pre-paint theme guard is MISSING from the served HTML — a saved-' +
            `${THEME} visitor gets the other theme for the first frame (injected by vite.config.ts; rebuild / check dist/)`,
        );
      }
    }
  }

  await context.close();

  return {
    route,
    device: device.name,
    httpStatus,
    authViolations,
    themeViolations,
    themeProbe,
    themeAtDomReady,
    themeGuardShipped,
    authSession,
    consoleErrors: consoleErrors.slice(0, 5),
    pageErrors: pageErrors.slice(0, 5),
    failedRequests: failedRequests.slice(0, 5),
    ...audit,
    linkChecks,
  };
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

function issueCount(r) {
  return (
    (r.authViolations?.length || 0) +
    (r.themeViolations?.length || 0) +
    (r.pageErrors?.length || 0) +
    (r.consoleErrors?.length || 0) +
    (r.badText?.length || 0) +
    (r.badCurrency?.length || 0) +
    (r.clippedText?.length || 0) +
    (r.genericButtons?.length || 0) +
    (r.hreflessLinks?.length || 0) +
    (r.unnamedInteractive?.length || 0) +
    (r.badPlaceholders?.length || 0) +
    (r.unlabeledInputs?.length || 0) +
    (r.externalLinkIssues?.length || 0) +
    (r.linkChecks?.length || 0) +
    (r.brokenImages?.length || 0) +
    (r.overflowOffenders?.length || 0) +
    (r.duplicateIds?.length || 0) +
    (r.headingSkips?.length || 0) +
    (r.docIssues?.length || 0) +
    // A soft-404 regression (probe answers 200) must still fail the run.
    (EXPECTED_NOT_FOUND_ROUTES.has(r.route) && r.httpStatus !== 404 ? 1 : 0)
  );
}

function summarize(results) {
  const by = (k) =>
    Object.entries(
      results.reduce((acc, r) => {
        for (const item of r[k] || []) {
          const key = typeof item === 'string' ? item : item.selector || item.href || item.text || JSON.stringify(item);
          acc[key] = (acc[key] || 0) + 1;
        }
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);

  return {
    loads: results.length,
    routes: [...new Set(results.map((r) => r.route))].length,
    authViolations: results
      .filter((r) => r.authViolations?.length)
      .map((r) => ({ route: r.route, device: r.device, errors: r.authViolations })),
    themeViolations: results
      .filter((r) => r.themeViolations?.length)
      .map((r) => ({ route: r.route, device: r.device, errors: r.themeViolations })),
    // Evidence, like authChrome: how many loads proved the guard ran BEFORE the
    // app booted. A themed run with 0 here is a themed run that measured nothing.
    themeEvidence: THEME
      ? {
          requested: THEME,
          guardShipped: results.filter((r) => r.themeGuardShipped === true).length,
          darkAtDomReady: results.filter((r) => r.themeAtDomReady === true).length,
          wrongTheme: results.filter((r) => r.themeProbe && r.themeProbe.dark !== (THEME === 'dark')).length,
        }
      : null,
    // Evidence, not decoration: an authenticated run must be able to show WHICH
    // chrome proved each load was signed in (text vs attribute), so a green run
    // cannot silently degrade into "matched nothing" on every route.
    authChrome: STORAGE
      ? {
          text: results.filter((r) => r.authChrome?.logoutSignal === 'text').length,
          attribute: results.filter((r) => r.authChrome?.logoutSignal === 'attribute').length,
          none: results.filter((r) => r.authChrome && !r.authChrome.logoutSignal).length,
        }
      : null,
    // The event half of the guard: how many loads GoTrue actually accepted.
    // `noTraffic` is legitimate (a still-valid access token needs no round trip),
    // which is exactly why `dead` — and not "did not prove it" — is the trigger.
    authSession: STORAGE
      ? {
          accepted: results.filter((r) => r.authSession && r.authSession.events?.length && !r.authSession.dead).length,
          noTraffic: results.filter((r) => r.authSession && !r.authSession.events?.length).length,
          dead: results.filter((r) => r.authSession?.dead).length,
        }
      : null,
    pageErrors: results.filter((r) => r.pageErrors?.length).map((r) => ({ route: r.route, device: r.device, errors: r.pageErrors })),
    consoleErrors: results.filter((r) => r.consoleErrors?.length).map((r) => ({ route: r.route, device: r.device, errors: r.consoleErrors })),
    badText: by('badText'),
    badCurrency: by('badCurrency'),
    clippedText: by('clippedText'),
    genericButtons: by('genericButtons'),
    hreflessLinks: by('hreflessLinks'),
    unnamedInteractive: by('unnamedInteractive'),
    badPlaceholders: by('badPlaceholders'),
    unlabeledInputs: by('unlabeledInputs'),
    externalLinkIssues: by('externalLinkIssues'),
    brokenLinks: results.flatMap((r) => (r.linkChecks || []).map((l) => ({ from: r.route, ...l }))).slice(0, 40),
    brokenImages: by('brokenImages'),
    overflowOffenders: by('overflowOffenders'),
    duplicateIds: by('duplicateIds'),
    headingSkips: [...new Set(results.flatMap((r) => r.headingSkips || []))],
    docIssues: by('docIssues'),
    httpFailures: results
      .filter((r) => r.httpStatus && r.httpStatus >= 400)
      .filter((r) => !(EXPECTED_NOT_FOUND_ROUTES.has(r.route) && r.httpStatus === 404))
      .map((r) => ({ route: r.route, status: r.httpStatus, device: r.device })),
    notFoundWrong: results
      .filter((r) => EXPECTED_NOT_FOUND_ROUTES.has(r.route) && r.httpStatus !== 404)
      .map((r) => ({ route: r.route, status: r.httpStatus, device: r.device })),
  };
}

async function main() {
  const exec = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exec) throw new Error('No Chrome binary found');
  const routes = args.routes
    ? args.routes.split(',').map((r) => (r.startsWith('/') ? r : `/${r}`))
    : GROUP === 'all'
      ? Object.values(ROUTE_GROUPS).flat()
      : ROUTE_GROUPS[GROUP];
  if (!routes) throw new Error(`Unknown group: ${GROUP}`);
  let storageState = null;
  if (STORAGE) {
    if (!fs.existsSync(STORAGE)) throw new Error(`Storage state not found: ${STORAGE}`);
    storageState = JSON.parse(fs.readFileSync(STORAGE, 'utf8'));
    console.log(`▶ authenticated run with storage: ${STORAGE} (role: ${ROLE || 'unknown'})`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: exec,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const jobs = [];
  VIEWPORTS.forEach((device) => routes.forEach((route) => jobs.push({ route, device })));
  console.log(`▶ element-audit[${GROUP}] · ${routes.length} routes × ${VIEWPORTS.length} viewports = ${jobs.length} loads (concurrency ${CONCURRENCY})`);

  let done = 0;
  const results = await runPool(
    jobs,
    async (job) => {
      const r = await auditOne(browser, job.route, job.device, storageState);
      done++;
      const n = issueCount(r);
      console.log(`  [${done}/${jobs.length}] ${job.route.padEnd(38)} ${job.device.name.padEnd(12)} ${n ? `⚠ ${n} issue(s)` : 'ok'}`);
      return r;
    },
    CONCURRENCY
  );

  await browser.close();

  const summary = summarize(results);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(OUT_DIR, `${PREFIX}-${GROUP}-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `${PREFIX}-${GROUP}-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify({ base: BASE, group: GROUP, generatedAt: new Date().toISOString(), summary, results }, null, 2));

  const lines = [
    `# Growlanzo element audit — ${GROUP}`,
    `Base: ${BASE} · ${summary.routes} routes × ${VIEWPORTS.length} viewports = ${summary.loads} loads`,
    `Authenticated run: ${STORAGE ? `yes (${STORAGE})` : 'no (anonymous)'}`,
    '',
    `## Auth integrity (must be empty on an authenticated run): ${summary.authViolations.length}`,
    ...summary.authViolations.map((a) => `- ${a.route} [${a.device}]: ${a.errors.join('; ')}`),
    ...(summary.authChrome
      ? [
          `## Auth chrome proof: ${summary.authChrome.text} load(s) via logout TEXT · ${summary.authChrome.attribute} via logout ATTRIBUTE · ${summary.authChrome.none} with no control`,
          ...results
            .filter((r) => r.authChrome && !r.authChrome.logoutSignal)
            .map((r) => `- ${r.route} [${r.device}] → ${r.authChrome.path} (no logout control)`),
        ]
      : []),
    ...(summary.authSession
      ? [
          `## Auth session proof: ${summary.authSession.accepted} load(s) had a GoTrue session check SUCCEED · ` +
            `${summary.authSession.noTraffic} had no GoTrue traffic (still-valid token) · ` +
            `${summary.authSession.dead} REJECTED by GoTrue`,
          ...results
            .filter((r) => r.authSession?.dead)
            .map((r) => `- ${r.route} [${r.device}] GoTrue: ${fmtAuthEvents(r.authSession.events)}`),
        ]
      : []),
    '',
    `## Page/console errors: ${summary.pageErrors.length + summary.consoleErrors.length}`,
    ...[...summary.pageErrors, ...summary.consoleErrors].map((e) => `- ${e.route} [${e.device}]: ${JSON.stringify(e.errors).slice(0, 160)}`),
    '',
    `## Leftover/placeholder text: ${summary.badText.length} unique`,
    ...summary.badText.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Wrong/broken currency: ${summary.badCurrency.length} unique`,
    ...summary.badCurrency.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Silently clipped text (mobile): ${summary.clippedText.length} unique`,
    ...summary.clippedText.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Generic button labels: ${summary.genericButtons.length} unique`,
    ...summary.genericButtons.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Unnamed interactive (icon-only a11y): ${summary.unnamedInteractive.length} unique`,
    ...summary.unnamedInteractive.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Bad placeholders: ${summary.badPlaceholders.length} unique`,
    ...summary.badPlaceholders.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Inputs without label: ${summary.unlabeledInputs.length} unique`,
    ...summary.unlabeledInputs.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## External link issues: ${summary.externalLinkIssues.length} unique`,
    ...summary.externalLinkIssues.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Broken internal links (4xx): ${summary.brokenLinks.length}`,
    ...summary.brokenLinks.map((l) => `- ${l.from} → ${l.link} (${l.status})`),
    '',
    `## Broken images: ${summary.brokenImages.length} unique`,
    ...summary.brokenImages.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Overflow offenders (non-scroller): ${summary.overflowOffenders.length} unique`,
    ...summary.overflowOffenders.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Duplicate ids: ${summary.duplicateIds.length} unique`,
    ...summary.duplicateIds.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## Heading skips: ${summary.headingSkips.length}`,
    ...summary.headingSkips.map((s) => `- ${s}`),
    '',
    `## Doc issues (title/lang/viewport): ${summary.docIssues.length} unique`,
    ...summary.docIssues.map(([k, n]) => `- ${n}× ${k}`),
    '',
    `## HTTP failures: ${summary.httpFailures.length}`,
    ...summary.httpFailures.map((f) => `- ${f.route} [${f.device}] ${f.status}`),
    '',
    `## 404-probe status wrong (expected 404): ${summary.notFoundWrong.length}`,
    ...summary.notFoundWrong.map((f) => `- ${f.route} [${f.device}] ${f.status}`),
    '',
    `## Theme sweep${THEME ? ` (--theme=${THEME})` : ''}: ${summary.themeViolations.length} load(s) wrong`,
    ...summary.themeViolations.map((t) => `- ${t.route} [${t.device}] ${t.errors.join('; ')}`),
  ];
  fs.writeFileSync(mdPath, lines.join('\n') + '\n');

  const total = results.reduce((s, r) => s + issueCount(r), 0);
  console.log(`\n✔ ${summary.loads} loads, ${total} raw issue flags`);
  if (summary.authChrome) {
    console.log(
      `Auth integrity evidence: ${summary.authChrome.text} load(s) proved signed-in by logout TEXT, ` +
        `${summary.authChrome.attribute} by logout ATTRIBUTE, ${summary.authChrome.none} with no logout control.`,
    );
    console.log(
      `Auth session evidence: ${summary.authSession?.accepted ?? 0} load(s) had a SUCCESSFUL GoTrue check, ` +
        `${summary.authSession?.noTraffic ?? 0} had no GoTrue traffic, ${summary.authSession?.dead ?? 0} were REJECTED by GoTrue.`,
    );
  }
  console.log(`Artifacts:\n  ${mdPath}\n  ${jsonPath}`);

  // A THEMED run in the wrong theme fails unconditionally, for the same reason
  // an unauthenticated "authenticated" run does: a green result would report
  // coverage it never had. Running with --theme=dark and letting a light page
  // pass is exactly the failure a human eyeball misses.
  if (THEME) {
    console.log(
      `Theme sweep (--theme=${THEME}): ${summary.themeViolations.length} load(s) wrong — ` +
        `${summary.themeEvidence.guardShipped}/${summary.loads} load(s) shipped the pre-paint guard, ` +
        `${summary.themeEvidence.darkAtDomReady}/${summary.loads} had .dark at DOMContentLoaded, ` +
        `${summary.themeEvidence.wrongTheme} ended on the other theme.`,
    );
    if (summary.themeViolations.length) {
      const uniqRoutes = [...new Set(summary.themeViolations.map((t) => t.route))];
      console.error(
        `::error::theme integrity: ${summary.themeViolations.length} load(s) of a --theme=${THEME} run were wrong on ` +
          `${uniqRoutes.length} route(s) (${uniqRoutes.slice(0, 6).join(', ')}${uniqRoutes.length > 6 ? ', …' : ''}). ` +
          `Reasons: ${[...new Set(summary.themeViolations.flatMap((t) => t.errors))].slice(0, 4).join(' | ')}. ` +
          `A themed sweep that measured nothing is not a pass.`,
      );
      process.exit(1);
    }
  }

  // An authenticated run that was NOT authenticated fails unconditionally:
  // its "green" would otherwise cover logged-out pages (see the header note).
  if (summary.authViolations.length) {
    const uniqRoutes = [...new Set(summary.authViolations.map((a) => a.route))];
    console.error(
      `::error::auth integrity: ${summary.authViolations.length} load(s) of an AUTHENTICATED run rendered a logged-out surface ` +
        `on ${uniqRoutes.length} route(s) (${uniqRoutes.slice(0, 6).join(', ')}${uniqRoutes.length > 6 ? ', …' : ''}). ` +
        `(logout chrome seen: text=${summary.authChrome?.text ?? 0} attribute=${summary.authChrome?.attribute ?? 0} none=${summary.authChrome?.none ?? 0}; ` +
        `GoTrue-rejected loads=${summary.authSession?.dead ?? 0}). ` +
        `The storage state is stale/expired — re-run login.mjs and repeat the sweep. This run proves nothing about those pages.`,
    );
    process.exit(1);
  }

  // --strict: non-zero exit when ANY issue is found (CI regression gate).
  // Report mode (default) always exits 0 — findings live in the artifacts.
  if (args.strict && total > 0) {
    // CI runs cannot download artifacts from the API without an admin token, so
    // emit the digest as an ::error:: annotation — visible on the run summary
    // and the merge box without any token. Keep it under the ~1KB per-message
    // annotation limit: category headers + the largest offenders first.
    const cat = (label, list, pick) => {
      if (!list?.length) return;
      const map = pick || ((x) => x);
      const uniq = [...new Set(list.map(map))];
      console.error(`::error::${label}: ${uniq.slice(0, 8).join(' | ')}${uniq.length > 8 ? ` | +${uniq.length - 8} more` : ''}`);
    };
    const uniq = (list) => [...new Set(list || [])];
    console.error(`::error::strict mode: ${total} issue flag(s) across ${summary.loads} loads — group=${GROUP} (full digest in the element-audit-results artifact)`);
    cat('console-error', uniq(summary.consoleErrors.flatMap((c) => c.errors)), (e) => e.slice(0, 120));
    cat('page-error', uniq(summary.pageErrors.flatMap((c) => c.errors)), (e) => e.slice(0, 120));
    cat('http-failure', summary.httpFailures.map((f) => `${f.route}[${f.device}] ${f.status}`));
    cat('not-found-status', summary.notFoundWrong.map((f) => `${f.route}[${f.device}] ${f.status} (expected 404)`));
    cat('bad-text', uniq(summary.badText.map(([s]) => s)));
    cat('bad-currency', uniq(summary.badCurrency.map(([s]) => s)));
    cat('generic-button', uniq(summary.genericButtons.map(([s]) => s)));
    cat('hrefless-link', uniq(summary.hreflessLinks.map(([s]) => s)));
    cat('unnamed-interactive', uniq(summary.unnamedInteractive.map(([k]) => k)));
    cat('bad-placeholder', uniq(summary.badPlaceholders.map(([s]) => s)));
    cat('unlabeled-input', uniq(summary.unlabeledInputs.map(([s]) => s)));
    cat('external-link-issue', uniq(summary.externalLinkIssues.map(([s]) => s)));
    cat('broken-link', summary.brokenLinks.map((l) => `${l.from} → ${l.link} (${l.status})`));
    cat('broken-image', uniq(summary.brokenImages.map(([s]) => s)));
    cat('overflow', uniq(summary.overflowOffenders.map(([s]) => s)));
    cat('duplicate-id', uniq(summary.duplicateIds.map(([k]) => k)));
    cat('heading-skip', uniq(summary.headingSkips));
    cat('doc-issue', uniq(summary.docIssues.map(([s]) => s)));
    cat('clipped-text', uniq(summary.clippedText.map(([s]) => s)));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
