import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// A real webhook signing secret was committed to a tracked Razorpay guide and
// verified live against the deployed function (a test event signed with it was
// accepted), i.e. anyone who could read the repository could forge a
// `payment.captured` event and fund an escrow that was never paid. The literal
// is gone from the working tree, but this class of defect re-appears every time
// someone pastes "the value I just generated" into a doc, a script or a test to
// make a probe work. So it is a build failure now, not a review comment.
//
// This file deliberately contains no real secret: every example is built from
// generated strings, so the scanner cannot flag its own test.

// The name must END in a credential word (`RAZORPAY_WEBHOOK_SECRET`, `TOKEN`,
// `PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`) — not merely contain one, or the
// banner comment `// ==== PUSH TOKENS ====` and routes like `FORGOT_PASSWORD`
// become false positives. Markdown table rows (`| NAME | value |`) are covered
// too: that is exactly the shape the real leak shipped in.
const CREDENTIAL_NAME_RE = /(?:SECRET|TOKEN|PASSWORD|KEY)$/;
const ASSIGNMENT_RE = /\b([A-Z][A-Z0-9_]{2,})\b\s*[:=|]\s*["'`]?([^\s"'`|]{16,})/;
const HEX64_RE = /\b[0-9a-f]{64}\b/;

// A 64-hex literal is allowed only where it is a *published digest* the founder
// is meant to compare against (sha256 of a public URL), and only when that same
// line does not look like it is naming a credential. Adding a new file here is a
// deliberate act, which is the point.
const HEX64_ALLOWLIST: Record<string, string> = {
  'skills-lock.json':
    'sha256 content hash of an installed agent skill (public upstream file, not a credential)',
};
const CREDENTIAL_WORD_RE = /(secret|password|token|api[_-]?key|service[_-]?role)/i;

// Values that are obviously not secrets: placeholders, template refs, route
// paths, prose, provider key *ids* (public by design) and anything with a slash
// or a URL scheme (those are paths/links, not credentials).
const PLACEHOLDER_RE =
  /^(<|\$\{|\$\(|your|xxx|todo|changeme|placeholder|none|null|\/|#)|rzp_(test|live)_|:\/\/|\//i;

/** A value only counts as a secret if it actually looks like one. */
function looksLikeSecretValue(value: string): boolean {
  if (value.length < 16) return false;
  if (!/[A-Za-z]/.test(value)) return false; // all-digits = ids, quantities, dates
  if (!/[0-9]/.test(value)) return false; // prose / single words
  if (PLACEHOLDER_RE.test(value)) return false;
  if (/^[._=-]+$/.test(value)) return false; // punctuation runs (banner comments)
  // Dotted/kebab slugs (`growlancer.browser-account.v1`) are storage keys and
  // identifiers, not credentials: every segment is lowercase alphanumeric.
  if (/^[a-z0-9]+(?:[.\-_][a-z0-9]+)+$/.test(value)) return false;
  return true;
}

const SKIP_PATHS =
  /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.env\.example|src\/test\/noCommittedSecrets\.test\.ts)$/;

function trackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n')
      .map((l) => l.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

const FILES = trackedFiles();

function read(file: string): string {
  try {
    return readFileSync(path.join(process.cwd(), file), 'utf8');
  } catch {
    return '';
  }
}

/** Scans a path→content map. Pure, so the controls below can feed it fixtures. */
export function findCommittedSecrets(files: Record<string, string>) {
  const assignmentHits: { file: string; name: string }[] = [];
  const hexHits: { file: string; line: number; text: string }[] = [];

  for (const [file, content] of Object.entries(files)) {
    if (SKIP_PATHS.test(file)) continue;
    content.split(/\r?\n/).forEach((line, index) => {
      const m = line.match(ASSIGNMENT_RE);
      if (m && CREDENTIAL_NAME_RE.test(m[1]) && looksLikeSecretValue(m[2])) {
        // Report the NAME, never the value.
        assignmentHits.push({ file, name: m[1] });
      }
      if (HEX64_RE.test(line)) {
        const allowed = HEX64_ALLOWLIST[file] !== undefined && !CREDENTIAL_WORD_RE.test(line);
        if (!allowed) hexHits.push({ file, line: index + 1, text: line.slice(0, 120) });
      }
    });
  }
  return { assignmentHits, hexHits };
}

const SCAN = FILES.length
  ? findCommittedSecrets(Object.fromEntries(FILES.map((f) => [f, read(f)])))
  : { assignmentHits: [], hexHits: [] };

describe('no committed secrets', () => {
  it('found the repository file list (the scan is not vacuous)', () => {
    // Tracked files only: an untracked scratch file cannot be committed by
    // accident, and CI only ever sees committed content anyway.
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES).toContain('GROWLANZO.md');
    expect(FILES).toContain('src/test/cors.test.ts');
    expect(FILES.some((f) => f.startsWith('supabase/functions/'))).toBe(true);
  });

  it('no secret-shaped assignment carries a real value', () => {
    expect(SCAN.assignmentHits).toEqual([]);
  });

  it('no 64-hex literal outside a documented public digest', () => {
    expect(SCAN.hexHits).toEqual([]);
  });

  it('the leaked webhook secret is really gone (guard against a silent regression)', () => {
    // Only the first 8 characters are named here: enough to recognise the value,
    // not enough to be a copy of it.
    const leakedPrefix = '295d03ef';
    const offenders = Object.entries(Object.fromEntries(FILES.map((f) => [f, read(f)])))
      // This file names the prefix on purpose, to keep the guard honest.
      .filter(([f]) => f !== 'src/test/noCommittedSecrets.test.ts')
      .filter(([, content]) => content.includes(leakedPrefix));
    expect(offenders.map(([f]) => f)).toEqual([]);
  });

  it('the published digest in an allowlisted file is not treated as a secret', () => {
    // Positive control for the allowlist: a digest line with no credential word
    // next to it must pass.
    const fixture = {
      'skills-lock.json': `"computedHash": "${'a'.repeat(64)}",`,
    };
    expect(findCommittedSecrets(fixture).hexHits).toEqual([]);
  });

  it('flags a pasted 64-hex secret (negative control)', () => {
    const fixture = { 'scripts/example.mjs': `const S = '${'b'.repeat(64)}';` };
    expect(findCommittedSecrets(fixture).hexHits).toHaveLength(1);
  });

  it('flags a hex literal that sits next to a credential word even in an allowlisted file (negative control)', () => {
    const fixture = { 'skills-lock.json': `webhook_secret = ${'c'.repeat(64)}` };
    expect(findCommittedSecrets(fixture).hexHits).toHaveLength(1);
  });

  it('flags a real-looking *_SECRET / *_TOKEN assignment (negative control)', () => {
    const fixture = {
      // The markdown-table shape the real leak shipped in.
      'docs/example.md': `| RAZORPAY_WEBHOOK_SECRET | ${'d3adB33f'.repeat(6)} |`,
      'scripts/example.mjs': `const TOKEN = "${'aB9xQ2'.repeat(6)}";`,
    };
    expect(findCommittedSecrets(fixture).assignmentHits.map((h) => h.name).sort()).toEqual([
      'RAZORPAY_WEBHOOK_SECRET',
      'TOKEN',
    ]);
  });

  it('does not flag placeholders, empty values or env lookups (negative control)', () => {
    const fixture = {
      '.env.example': 'RAZORPAY_WEBHOOK_SECRET=\nPAYPAL_CLIENT_SECRET=',
      'docs/example.md': 'RAZORPAY_WEBHOOK_SECRET=<new>\nCRON_SECRET=your-secret-here',
      'scripts/example.mjs': [
        `const s = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');`,
        `list.find((x) => x?.name === 'RAZORPAY_WEBHOOK_SECRET' && typeof x.value === 'string');`,
      ].join('\n'),
    };
    const { assignmentHits, hexHits } = findCommittedSecrets(fixture);
    expect(assignmentHits).toEqual([]);
    expect(hexHits).toEqual([]);
  });
});
