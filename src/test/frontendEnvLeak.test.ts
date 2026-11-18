/**
 * Nothing secret may be reachable from the browser bundle.
 *
 * Vite only inlines variables whose name starts with `VITE_`, so a server
 * secret referenced in `src/` is not *usually* leaked — but two real accidents
 * are still possible and both have happened in this repo's history:
 *
 *   1. Someone renames a server key to `VITE_*` to "make it work" in the client
 *      (e.g. `VITE_RAZORPAY_KEY_SECRET`). From that moment the secret is
 *      compiled into every visitor's JavaScript.
 *   2. Someone reads a secret through `process.env` in a file that ships to the
 *      browser. Vite does not define `process.env` in the browser build, so the
 *      read either throws at runtime or, in a Node-ish build, really does inline
 *      the value.
 *
 * Both are silent: the page looks fine and the key is gone. So this is a build
 * failure instead of a review comment. It is a *source* guard (same technique as
 * the bare-`import.meta.env` guard in `featureFlagsEnv.test.ts`) because the
 * defect has to be caught before the bundle is produced, not after.
 *
 * This file contains no secret: it only names the variables it forbids.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');
const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
/** `src/test/**` is allowed to NAME secrets; it never ships. */
const NON_SHIPPING = new Set(['src/test']);

/** Built-ins that Vite always provides and that carry no secret. */
const ALLOWED_BARE = new Set(['DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(process.cwd(), full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (NON_SHIPPING.has(rel) || entry.name === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (SOURCE_EXT.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Every `import.meta.env` access in the file, as the name it reads. */
function envReads(code: string): string[] {
  const names: string[] = [];
  // import.meta.env.NAME   and   import.meta.env?.NAME
  for (const m of code.matchAll(/import\.meta\.env\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) {
    names.push(m[1]);
  }
  // import.meta.env['NAME']   and   import.meta.env?.['NAME']
  for (const m of code.matchAll(/import\.meta\.env\s*\??\.?\[\s*['"`]([^'"`]+)['"`]\s*\]/g)) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Keys that must never be readable by the browser, whatever the prefix.
 * Mirrors the edge-function secret list and `.env.example`.
 */
const FORBIDDEN_IN_BROWSER = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_PAYOUT_WEBHOOK_SECRET',
  'RAZORPAY_ACCOUNT_NUMBER',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'BREVO_API_KEY',
  'BREVO_WEBHOOK_SECRET',
  'EXA_API_KEY',
  'AI_API_KEY',
  'CRON_SECRET',
  'ADMIN_SIGNUP_SECRET',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_URL',
];

describe('the browser bundle can only read public configuration', () => {
  const files = sourceFiles(SRC);

  it('scans the whole shipping source tree', () => {
    // A guard over zero files would pass forever.
    expect(files.length).toBeGreaterThan(100);
  });

  it('every import.meta.env read is a VITE_ public variable or a Vite built-in', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
      const code = readFileSync(file, 'utf8');
      for (const name of envReads(code)) {
        if (name.startsWith('VITE_') || ALLOWED_BARE.has(name)) continue;
        offenders.push(`${rel}: import.meta.env.${name}`);
      }
    }
    expect(offenders, `Non-public env read in shipping code:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no secret is exposed under a public VITE_ prefix', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
      const code = readFileSync(file, 'utf8');
      for (const name of envReads(code)) {
        const bare = name.replace(/^VITE_/, '');
        if (FORBIDDEN_IN_BROWSER.includes(bare)) offenders.push(`${rel}: ${name}`);
      }
    }
    expect(
      offenders,
      `A server-side secret is exposed to the browser:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('shipping code never reads process.env (Vite does not define it in the browser)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
      if (!/\bprocess\.env\b/.test(readFileSync(file, 'utf8'))) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      `process.env read in browser code — use import.meta.env.VITE_* instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the shipped bundle only ever names VITE_ variables in the committed env template', () => {
    const example = readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
    // The template lists server secrets on purpose (it is documentation), but
    // every one of them must be commented out or left empty, so copying the file
    // into Vercel cannot silently publish a value.
    const assignedSecrets = example
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*\s*=\s*\S/.test(line))
      .map((line) => line.split('=')[0].trim())
      .filter((name) => !name.startsWith('VITE_'))
      .filter((name) => !['APP_URL', 'AI_BASE_URL', 'AI_MODEL', 'PAYPAL_SANDBOX'].includes(name))
      .filter((name) => FORBIDDEN_IN_BROWSER.includes(name));
    expect(assignedSecrets, `Non-empty secret in .env.example: ${assignedSecrets.join(', ')}`).toEqual(
      [],
    );
  });
});
