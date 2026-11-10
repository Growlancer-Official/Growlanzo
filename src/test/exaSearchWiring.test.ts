import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Exa web search is server-only by design.
 *
 * `EXA_API_KEY` spends a metered Exa account, so the key may exist only in the
 * edge-function secret store — never in `src/` (which ships to every browser)
 * and never as a literal in the repo. Nothing would fail loudly if a page
 * imported the shared helper to "just do a search": the Vite build would either
 * inline `Deno.env` as undefined (dead feature) or, worse, a future refactor
 * would move the key into a `VITE_` var and publish it. This guard pins the
 * contract the endpoint depends on.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  } catch {
    return '';
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests may legitimately name the secret in an assertion.
      if (rel === 'src/test') continue;
      walk(rel, acc);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      acc.push(rel);
    }
  }
  return acc;
}

describe('Exa web search wiring', () => {
  const shared = read('supabase/functions/_shared/exa.ts');
  const fn = read('supabase/functions/exa-search/index.ts');

  it('uses the official SDK and asks Exa for highlights', () => {
    expect(shared).toMatch(/import Exa from 'npm:exa-js@\d+\.\d+\.\d+';/);
    expect(shared).toContain('new Exa(');
    expect(shared).toContain('.search(');
    expect(shared).toContain('contents: { highlights: true }');
  });

  it('reads the key from the environment only, with no committed value', () => {
    expect(shared).toContain("Deno.env.get('EXA_API_KEY')");
    // `EXA_API_KEY=` followed by anything other than end-of-line is a value.
    expect(shared).not.toMatch(/EXA_API_KEY\s*=\s*['"`][^'"`]+['"`]/);
    expect(fn).not.toMatch(/EXA_API_KEY\s*=\s*['"`][^'"`]+['"`]/);
  });

  it('declares the key empty in the example env file', () => {
    expect(read('.env.example')).toMatch(/^EXA_API_KEY=$/m);
  });

  it('authenticates the caller and fails closed when unconfigured', () => {
    expect(fn).toContain('auth.getUser()');
    expect(fn).toContain('EXA_CONFIGURED');
    expect(fn).toContain('webSearch(');
    // Identity comes from the JWT, never from the request body.
    expect(fn).not.toContain('body.user_id');
    expect(fn).not.toContain('body?.user_id');
  });

  it('keeps the server-only module and key out of the client bundle', () => {
    const offenders = walk('src').filter((file) => {
      const content = read(file);
      return content.includes('EXA_API_KEY') || content.includes("_shared/exa.ts'");
    });
    expect(offenders).toEqual([]);
  });
});
