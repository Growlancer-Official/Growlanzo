import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locks the icon-pack consolidation (founder directive, task 1).
 *
 * Growlanzo's icon pack is lucide-react (already the standard across ~130
 * files). These assertions read the source so the hand-drawn, inconsistent
 * inline SVGs cannot creep back into the files that were migrated, and so the
 * justified exceptions — official brand logos and the certificate seal —
 * stay exactly where they are.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** Files whose hand-drawn UI icons were migrated to lucide-react. */
const MIGRATED = [
  'src/layouts/MainLayout.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/components/ProtectedRoute.tsx',
  'src/pages/admin/AdminSupportTicketsPage.tsx',
  'src/layouts/AdminDashboardLayout.tsx',
  'src/pages/dashboard/ProfessionalProfilePage.tsx',
  'src/pages/HomePage.tsx',
  'src/pages/AboutPage.tsx',
];

describe('hand-drawn UI icons are gone from the migrated files', () => {
  for (const rel of MIGRATED) {
    it(`${rel} has no raw <svg> — lucide-react only`, () => {
      const src = readSource(rel);
      expect(src, `${rel} must use the icon pack`).not.toContain('<svg');
      expect(src).toContain("from 'lucide-react'");
    });
  }

  it('the shared referral invite card keeps its UI icons in the icon pack', () => {
    const src = readSource('src/components/ReferralInviteCard.tsx');
    expect(src).toContain("from 'lucide-react'");
    // Only the three official brand marks may be drawn by hand.
    expect((src.match(/<svg/g) || []).length).toBe(3);
  });

  it('the specific hand-drawn paths that were removed stay removed', () => {
    // Mail path reused by ProtectedRoute / ReferralsPage / MainLayout.
    for (const rel of [
      'src/components/ProtectedRoute.tsx',
      'src/pages/ReferralsPage.tsx',
      'src/layouts/MainLayout.tsx',
    ]) {
      expect(readSource(rel), rel).not.toContain('M3 8l7.89 5.26a2 2 0 002.22 0');
    }
    // Back-arrow path (admin support tickets).
    expect(readSource('src/pages/admin/AdminSupportTicketsPage.tsx')).not.toContain(
      'M19 12H5M12 19l-7-7 7-7'
    );
    // Check-circle path (client referrals).
    expect(readSource('src/pages/ClientReferralsPage.tsx')).not.toContain(
      'M9 12l2 2 4-4m6 2a9 9 0 11-18 0'
    );
    // The emoji globe in the country dropdown is an icon, not content.
    expect(readSource('src/components/CountrySelect.tsx')).not.toContain('🌐');
  });

  it('the page-justifying swaps happened', () => {
    const main = readSource('src/layouts/MainLayout.tsx');
    // Contests gets a trophy, not a download arrow; Dashboard gets the
    // dashboard glyph, not an enter/external path.
    expect(main).toContain('<Trophy');
    expect(main).not.toContain('d="M12 3v12m0 0l-3-3m3 3l3-3M6 21h12"');
    expect(main).toContain('<LayoutDashboard');
  });
});

describe('justified brand marks and artwork are preserved', () => {
  const ALLOWLIST: [string, number][] = [
    ['src/components/OAuthButtons.tsx', 2], // GitHub + LinkedIn
    ['src/components/PayPalCheckout.tsx', 1], // PayPal logo
    // Payment marks (Razorpay + PayPal + Mastercard) plus the social marks the
    // footer's "Follow us" row now carries (X + Instagram + LinkedIn).
    ['src/components/SiteFooter.tsx', 6],
    ['src/pages/CertificateVerifyPage.tsx', 1], // animated seal artwork
    // The share buttons (and their brand marks) now live in ONE component that
    // both referral pages render, so the counts moved with them.
    ['src/components/ReferralInviteCard.tsx', 3], // WhatsApp + LinkedIn + X (Email is a lucide UI icon)
    ['src/pages/ReferralsPage.tsx', 0],
    ['src/pages/ClientReferralsPage.tsx', 0],
  ];

  for (const [rel, expected] of ALLOWLIST) {
    it(`${rel} keeps exactly ${expected} brand <svg>`, () => {
      const src = readSource(rel);
      const count = (src.match(/<svg/g) || []).length;
      expect(count, `${rel} brand logos must not be deleted`).toBe(expected);
    });
  }
});
