/**
 * Release-surface guards for the 2026-10-25 launch pass.
 *
 * Each assertion corresponds to a defect reproduced in the built app:
 *  - the LinkedIn tile drew the "in" glyph in the same #0A66C2 as its button,
 *    so the icon rendered as a blank square;
 *  - every newsletter welcome email linked to /unsubscribe, which had no route;
 *  - billing/proposal/security emails linked to paths that no longer exist;
 *  - the visible support mailbox used the private owner Gmail instead of the
 *    monitored support inbox (now fixed: support@growlanzo.com everywhere public).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const APP = read('src/app/App.tsx');
const OAUTH = read('src/components/OAuthButtons.tsx');
const FOOTER = read('src/components/SiteFooter.tsx');

describe('support mailbox', () => {
  it('the footer shows the monitored support inbox, not the owner Gmail', () => {
    expect(FOOTER).toContain('support@growlanzo.com');
    expect(FOOTER).not.toContain('growlanzo.own@gmail.com');
  });

  for (const page of [
    'src/pages/TermsPage.tsx',
    'src/pages/PrivacyPage.tsx',
    'src/pages/CookiesPage.tsx',
  ]) {
    it(`${path.basename(page)} points at the support inbox, not the owner Gmail`, () => {
      const src = read(page);
      expect(src).toContain('support@growlanzo.com');
      expect(src).not.toContain('growlanzo.own@gmail.com');
    });
  }

  it('transactional emails link to the support inbox, not the owner Gmail', () => {
    const src = read('supabase/functions/email-notifications/index.ts');
    expect(src).toContain('mailto:support@growlanzo.com');
    expect(src).not.toContain('mailto:growlanzo.own@gmail.com');
  });
});

describe('LinkedIn sign-in mark', () => {
  it('is drawn in currentColor, not brand blue on a brand-blue button', () => {
    expect(OAUTH).toContain("fill=\"currentColor\"");
    expect(OAUTH).not.toContain('fill="#0A66C2"');
  });

  it('keeps both OAuth providers', () => {
    expect(OAUTH).toContain("id: 'github'");
    expect(OAUTH).toContain("id: 'linkedin_oidc'");
  });
});

describe('no user-facing route 404s', () => {
  it('registers the unsubscribe page', () => {
    expect(APP).toContain('path="/unsubscribe"');
    expect(fs.existsSync(path.join(process.cwd(), 'src/pages/UnsubscribePage.tsx'))).toBe(true);
  });

  it('aliases the old dashboard and client ticket paths', () => {
    expect(APP).toMatch(/path="projects"[^\n]*Navigate to="\/dashboard\/feed"/);
    expect(APP).toMatch(/path="subscription"[^\n]*Navigate to="\/dashboard\/pro"/);
    expect(APP).toMatch(/path="tickets"[^\n]*Navigate to="\/client\/support-tickets"/);
  });

  it('security-alert emails no longer link to /admin/security', () => {
    const src = read('supabase/functions/security-alert-notify/index.ts');
    expect(src).not.toContain('/admin/security');
  });
});

describe('cookie banner cannot cover the early-access form', () => {
  it('the waitlist page reserves the banner height', () => {
    expect(read('src/pages/WaitlistPage.tsx')).toContain('--consent-banner-h');
  });
});
