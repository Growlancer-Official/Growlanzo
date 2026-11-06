/**
 * Guard: the Express/VPS server and Vercel must ship identical security headers.
 *
 * `server.js` and `vercel.json` each used to carry their own hand-maintained
 * copy. They silently drifted, and the drift was not cosmetic: server.js's CSP
 * omitted the Razorpay checkout hosts (checkout-static-next, cdn, express,
 * lumberjack, api-dark) from script-src/connect-src/frame-src and set
 * `payment=()`, while production allowed them. A deploy served by server.js
 * would have failed checkout in the browser — a payment defect that no unit
 * test, typecheck or build could see, because a CSP is enforced by the browser.
 *
 * The values now live in security-headers.json. This test pins that file to
 * vercel.json, so the only way to change a header is to change both.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const shared = JSON.parse(read('security-headers.json')) as Record<string, string>;

const vercel = JSON.parse(read('vercel.json')) as {
  headers?: { source: string; headers: { key: string; value: string }[] }[];
};

const vercelHeaders: Record<string, string> = {};
for (const block of vercel.headers ?? []) {
  for (const header of block.headers) vercelHeaders[header.key] = header.value;
}

describe('security header parity (server.js ⇄ vercel.json)', () => {
  it('vercel.json actually defines the production header block', () => {
    // Self-check: if the config is restructured, fail loudly instead of
    // comparing against an empty object and passing vacuously.
    expect(Object.keys(vercelHeaders).length).toBeGreaterThan(0);
  });

  it('every shipped header matches the production value exactly', () => {
    const drifted = Object.keys(shared).filter((key) => vercelHeaders[key] !== shared[key]);
    expect(drifted).toEqual([]);
  });

  it('covers the full production header set (nothing is silently dropped)', () => {
    expect(Object.keys(shared).sort()).toEqual(Object.keys(vercelHeaders).sort());
  });

  it('server.js applies the shared file instead of its own copy', () => {
    const source = read('server.js');
    expect(source).toContain('security-headers.json');
    // A second hardcoded definition is exactly how the drift started. Match the
    // setHeader CALL (not the value) so the explanatory comment above it, which
    // has to name the old broken values, cannot trip the guard.
    const codeLines = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeLines).not.toContain("setHeader('Content-Security-Policy'");
    expect(codeLines).not.toContain("setHeader('Permissions-Policy'");
  });

  it('the CSP still contains the hosts checkout actually needs', () => {
    const csp = shared['Content-Security-Policy'] ?? '';
    for (const host of [
      'https://checkout.razorpay.com',
      'https://checkout-static-next.razorpay.com',
      'https://api.razorpay.com',
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'https://api.fontshare.com',
    ]) {
      expect(csp).toContain(host);
    }
    // object-src/base-uri/form-action are the cheap wins against injection.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
