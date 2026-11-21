import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locks the profiles_private privilege boundary established by migration
 * 20270119000013_lock_profiles_private_privileges.sql.
 *
 * Why this exists: profiles_private holds `is_admin` — and admin-data's
 * verifyAdminSession trusts that single column, so a client that can write it
 * holds the whole admin API. Admin suspension state lives there too, so the
 * same write is how a suspended account un-bans itself. The fix has two layers
 * (a column-level ACL and a BEFORE INSERT OR UPDATE trigger) and both lists are
 * read straight out of the migration, so the migration and this test cannot
 * drift apart.
 *
 * The failure it guards against is silent and easy to reintroduce: someone adds
 * `is_admin` to a browser-side update, or a migration re-grants table-wide
 * UPDATE on profiles_private again.
 */
const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '../..');
const MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20270119000013_lock_profiles_private_privileges.sql',
);
const SQL = fs.readFileSync(MIGRATION, 'utf8');

/** Reads a `-- <MARKER>: a, b, c` comment line out of the migration. */
function markerList(marker: string): string[] {
  const line = SQL.split(/\r?\n/).find((l) => l.includes(marker));
  expect(line, `migration lost its "${marker}" marker`).toBeDefined();
  return (line as string)
    .slice((line as string).indexOf(marker) + marker.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const GUARDED = markerList('GUARDED-COLUMNS:');
const CLIENT_WRITE = markerList('CLIENT-WRITE-COLUMNS:');

/**
 * Top-level keys of an inline object literal. Splits on commas that sit at
 * depth 0 and outside string literals, so nested objects and a value such as
 * `reason: 'a, b'` cannot produce fragments that look like column names.
 */
function topLevelKeys(objLiteral: string): string[] {
  const inner = objLiteral.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
  const entries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  entries.push(current);

  const keys: string[] = [];
  for (const entry of entries) {
    const m = /^\s*(?:['"]([A-Za-z_][A-Za-z0-9_]*)['"]|([A-Za-z_][A-Za-z0-9_]*))\s*:/.exec(entry);
    const name = m?.[1] ?? m?.[2];
    if (name && !keys.includes(name)) keys.push(name);
  }
  return keys;
}

interface PrivateWrite {
  file: string;
  method: string;
  keys: string[];
  /** false when the payload is not an inline object literal we can inspect. */
  inspectable: boolean;
}

/**
 * Every place app code writes to profiles_private, with the columns it names.
 *
 * The write method must be the *next* call in the chain, which is how all real
 * call sites are written — matching further ahead would attach an unrelated
 * later `.update(` to a read-only query and invent offenders.
 */
function profilesPrivateWrites(): PrivateWrite[] {
  const out: PrivateWrite[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && full !== THIS_FILE) {
        const source = fs.readFileSync(full, 'utf8');
        // Only the call up to `(` is consumed, so one match can never swallow
        // the call sites that follow it.
        const re = /\.from\(\s*['"]profiles_private['"]\s*\)\s*\.(update|upsert|insert)\(/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
          const body = source.slice(re.lastIndex, re.lastIndex + 5000);
          const brace = body.indexOf('{');
          if (brace === -1) {
            out.push({
              file: path.relative(ROOT, full),
              method: match[1],
              keys: [],
              inspectable: false,
            });
            continue;
          }
          let depth = 0;
          let end = brace;
          for (let i = brace; i < body.length; i += 1) {
            if (body[i] === '{') depth += 1;
            else if (body[i] === '}') {
              depth -= 1;
              if (depth === 0) {
                end = i;
                break;
              }
            }
          }
          out.push({
            file: path.relative(ROOT, full),
            method: match[1],
            keys: topLevelKeys(body.slice(brace, end + 1)),
            inspectable: true,
          });
        }
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

const WRITES = profilesPrivateWrites();

describe('profiles_private privilege boundary (migration 20270119000013)', () => {
  it('declares a guarded list and a client-writable list that do not overlap', () => {
    expect(GUARDED.length).toBeGreaterThan(0);
    expect(CLIENT_WRITE.length).toBeGreaterThan(0);
    expect(GUARDED.filter((c) => CLIENT_WRITE.includes(c))).toEqual([]);
  });

  it('finds the known browser write sites, so the checks below cannot pass vacuously', () => {
    // authService: the duplicate-email update and the signup fallback upsert.
    expect(WRITES.length).toBeGreaterThanOrEqual(2);
    expect(WRITES.some((w) => w.method === 'upsert')).toBe(true);
    // A payload we cannot read (a variable, a spread) must fail loudly here
    // rather than slip past the column checks below.
    expect(WRITES.filter((w) => !w.inspectable).map((w) => `${w.file} → ${w.method}`)).toEqual(
      [],
    );
  });

  it('guards exactly the admin flag and the suspension state', () => {
    expect([...GUARDED].sort()).toEqual(
      ['banned_at', 'is_admin', 'suspend_reason', 'suspended_at', 'suspended_by'].sort(),
    );
  });

  it('grants app roles write access to the client columns only', () => {
    for (const verb of ['INSERT', 'UPDATE']) {
      const grant = new RegExp(`GRANT ${verb} \\(([^)]*)\\)\\s*\\r?\\n?\\s*ON public\\.profiles_private TO anon, authenticated`).exec(
        SQL,
      );
      expect(grant, `migration lost its GRANT ${verb} statement`).toBeDefined();
      const granted = (grant as RegExpExecArray)[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      expect([...granted].sort()).toEqual([...CLIENT_WRITE].sort());
    }
    // …and the table-wide grant really was revoked first.
    expect(SQL).toMatch(
      /REVOKE UPDATE, INSERT ON public\.profiles_private FROM anon, authenticated/,
    );
  });

  it('blocks every guarded column in the trigger body, on INSERT and UPDATE', () => {
    for (const col of GUARDED) {
      expect(SQL).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    }
    expect(SQL).toMatch(/BEFORE INSERT OR UPDATE ON public\.profiles_private/);
    // The service_role exemption is what keeps the admin suspend path alive.
    expect(SQL).toMatch(/auth\.jwt\(\) ->> 'role'/);
  });

  it('has no app code writing a guarded column to profiles_private', () => {
    const offenders = WRITES.filter((w) => w.keys.some((k) => GUARDED.includes(k)));
    expect(WRITES.length).toBeGreaterThan(0);
    expect(
      offenders.map((w) => `${w.file} → ${w.method}({${w.keys.join(', ')}})`),
    ).toEqual([]);
  });

  it('every app write to profiles_private stays inside the client-writable columns', () => {
    const unexpected = WRITES.filter((w) => w.keys.some((k) => !CLIENT_WRITE.includes(k)));
    expect(
      unexpected.map((w) => `${w.file} → ${w.method}({${w.keys.join(', ')}})`),
    ).toEqual([]);
  });
});

/**
 * The drift monitor (migration 20270119000014) is what makes this bug class
 * self-detecting: it alerts when a trust-shaped column becomes writable by the
 * authenticated role on an owner-scoped table with no protect_* guard — the
 * exact shape of the profiles_private.is_admin hole. These assertions keep the
 * detector and the guards from drifting apart.
 */
const DRIFT = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20270119000014_drift_monitor_trust_columns.sql'),
  'utf8',
);

/** Comments carry prose (and apostrophes) that would be parsed as values. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

const DRIFT_SQL = stripSqlComments(DRIFT);

function sqlList(re: RegExp, source: string, label: string): string[] {
  const m = re.exec(source);
  expect(m, `${label} not found in the drift monitor migration`).not.toBeNull();
  return [...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const DRIFT_TRUST_COLUMNS = sqlList(
  /a\.attname IN \(\s*([\s\S]*?)\)\s*OR \(a\.attname = 'role'/,
  DRIFT_SQL,
  'trust-column list',
);
const DRIFT_EXCEPTIONS = sqlList(
  /NOT IN \(\s*([\s\S]*?)\)\s*ORDER BY/,
  DRIFT_SQL,
  'exception list',
);

describe('security drift monitor (migration 20270119000014)', () => {
  it('watches every column the privilege lock protects', () => {
    for (const col of GUARDED) {
      expect(DRIFT_TRUST_COLUMNS, `${col} is not watched by the drift sweep`).toContain(col);
    }
    expect(DRIFT_TRUST_COLUMNS).toContain('reputation_score');
    expect(DRIFT_TRUST_COLUMNS).toContain('seller_level');
  });

  it('keeps its exception list closed and documented', () => {
    // Adding an unguarded trust column must be a deliberate act: it means
    // widening this list (with a reason) rather than letting the monitor scream.
    expect([...DRIFT_EXCEPTIONS].sort()).toEqual(
      [
        'reviews.rating',
        // Documented in 20270402000000_platform_reviews.sql: the review's own
        // author may edit their platform review; the trigger locks it on UPDATE.
        'platform_reviews.rating',
        'certifications.verified',
        'freelancer_skills.is_verified',
        'payout_methods.is_verified',
        'services.rating',
      ].sort(),
    );
  });

  it('sweeps the self-writable columns from the hourly monitor, server-side only', () => {
    expect(DRIFT).toContain('CREATE OR REPLACE FUNCTION public.self_writable_trust_columns()');
    expect(DRIFT).toMatch(
      /REVOKE ALL ON FUNCTION public\.self_writable_trust_columns\(\) FROM PUBLIC, anon, authenticated/,
    );
    expect(DRIFT).toContain('self_writable_trust_column'); // the alert category
    expect(DRIFT).toMatch(/EXECUTE v_new/); // the patch actually applies
    // Fail-closed: the migration must refuse to land if the live schema is dirty
    expect(DRIFT).toMatch(/Unguarded trust column\(s\) present/);
    // …and must prove the detector works rather than merely being quiet
    expect(DRIFT).toMatch(/_drift_probe_trust/);
  });
});
