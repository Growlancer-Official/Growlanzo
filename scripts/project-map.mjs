#!/usr/bin/env node
/**
 * Project map — generated inventory of the repo's structural surface.
 *
 * Why this exists: the end-to-end map in `GROWLANZO.md` is only
 * useful if it cannot silently drift from the tree. Every page, component,
 * service, edge function, migration and test is listed here mechanically, and
 * `src/test/projectMap.test.ts` fails when this file is stale. So adding a
 * migration (or deleting a service) forces the map to be refreshed in the same
 * change — the documentation cannot rot quietly.
 *
 * It lists NAMES ONLY. No sizes, dates or hashes: output must be deterministic
 * across machines and commits so the drift check compares real structure, not
 * noise.
 *
 * Usage:
 *   node scripts/project-map.mjs           # write docs/blueprint/INVENTORY.md
 *   node scripts/project-map.mjs --check   # exit 1 if the file is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), '..');
export const INVENTORY_PATH = path.join(ROOT, 'docs', 'blueprint', 'INVENTORY.md');

/**
 * Floors are deliberately below today's real counts. A broken glob that returns
 * three files must fail loudly instead of producing a clean-looking, vacuous
 * map — the same anti-vacuity rule the SQL lexer guard follows.
 */
const MINIMUMS = {
  pages: 50,
  components: 40,
  libraries: 40,
  edgeFunctions: 30,
  migrations: 250,
  tests: 40,
};

function walk(dir, predicate) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      found.push(...walk(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      found.push(full);
    }
  }
  return found;
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function list(dir, predicate, options = {}) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) return [];
  const files = options.recursive === false
    ? fs.readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isFile() && predicate(entry.name))
        .map((entry) => path.join(base, entry.name))
    : walk(base, (file) => predicate(path.basename(file)));
  return files
    .map(relative)
    .filter((file) => !path.basename(file).startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function byExtension(extensions) {
  return (name) => extensions.some((extension) => name.endsWith(extension));
}

const GROUPS = [
  {
    key: 'pages',
    title: 'Pages',
    note: 'Every route renders one of these. Page files are lazy-loaded from `src/app/App.tsx` unless noted there.',
    files: list('src/pages', byExtension(['.tsx'])),
  },
  {
    key: 'layouts',
    title: 'Layouts',
    note: 'The four shells: public, freelancer dashboard, client dashboard, admin console.',
    files: list('src/layouts', byExtension(['.tsx'])),
  },
  {
    key: 'components',
    title: 'Components',
    note: 'Shared UI. Feature-specific components live next to their page instead.',
    files: list('src/components', byExtension(['.tsx'])),
  },
  {
    key: 'state',
    title: 'Context & hooks',
    note: 'Cross-page state (auth, theme, currency) and reusable data hooks.',
    files: [
      ...list('src/context', byExtension(['.tsx', '.ts'])),
      ...list('src/hooks', byExtension(['.ts', '.tsx'])),
    ].sort((a, b) => a.localeCompare(b, 'en')),
  },
  {
    key: 'libraries',
    title: 'Client libraries & services',
    note: 'All data access, business rules and formatting live here — pages call services, not Supabase directly (with few explicit exceptions).',
    files: [
      ...list('src/lib', (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'), {
        recursive: false,
      }),
      ...list('src/lib/services', (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'), {
        recursive: false,
      }),
    ].sort((a, b) => a.localeCompare(b, 'en')),
  },
  {
    key: 'edgeFunctions',
    title: 'Edge functions',
    note: 'One directory per deployed function; `_shared` is imported, never deployed on its own.',
    files: list(
      'supabase/functions',
      (name) => name === 'index.ts',
      { recursive: true }
    ).filter((file) => !file.startsWith('supabase/functions/_shared/')),
  },
  {
    key: 'sharedFunctions',
    title: 'Edge shared modules',
    note: 'The runtime contract every function imports: CORS, site URL, auth, rate limits, email, money helpers.',
    files: list('supabase/functions/_shared', byExtension(['.ts'])),
  },
  {
    key: 'migrations',
    title: 'Database migrations',
    note: 'Ordered by filename timestamp. Applied by `supabase db push --include-all` in Backend Deploy; never by hand in the dashboard.',
    files: list('supabase/migrations', byExtension(['.sql']), { recursive: false }),
  },
  {
    key: 'archivedMigrations',
    title: 'Archived migrations (not applied)',
    note: 'Kept for history only. `db push` reads the top level of `supabase/migrations`, so these are never applied.',
    files: list('supabase/migrations/archived', byExtension(['.sql'])),
  },
  {
    key: 'tests',
    title: 'Test suite',
    note: 'Vitest, jsdom, single worker (see `vitest.config.ts`). Security and money invariants have guard tests here.',
    files: list('src/test', (name) => name.endsWith('.test.ts') || name.endsWith('.test.tsx')),
  },
  {
    key: 'scripts',
    title: 'Operational scripts',
    note: 'Build, preflight, security audit and the E2E harnesses. Nothing here is imported by the app.',
    files: [
      ...list('scripts', (name) => name.endsWith('.mjs') && !name.includes('.tmp.'), {
        recursive: false,
      }),
      ...list('scripts/e2e', (name) => name.endsWith('.mjs'), { recursive: false }),
    ].sort((a, b) => a.localeCompare(b, 'en')),
  },
  {
    key: 'workflows',
    title: 'CI / deploy workflows',
    note: 'GitHub Actions. A push to `main` is the deploy trigger for both halves of the product.',
    files: list('.github/workflows', byExtension(['.yml'])),
  },
];

function buildSections() {
  for (const [key, floor] of Object.entries(MINIMUMS)) {
    const group = GROUPS.find((candidate) => candidate.key === key);
    if (!group) throw new Error(`project-map: no group named "${key}"`);
    if (group.files.length < floor) {
      throw new Error(
        `project-map: ${group.title} found ${group.files.length} files, below the floor of ${floor}. ` +
          'A broken glob must not produce a vacuously clean map.'
      );
    }
  }

  const total = GROUPS.reduce((sum, group) => sum + group.files.length, 0);
  const lines = [];

  lines.push('# Project inventory — generated');
  lines.push('');
  lines.push('> Generated by `npm run docs:map` from the working tree. **Do not edit by hand.**');
  lines.push('> `src/test/projectMap.test.ts` fails when this file is stale, so a new page,');
  lines.push('> function, migration or test cannot land without refreshing the map.');
  lines.push('');
  lines.push(`Total tracked structure: **${total} files** across ${GROUPS.length} groups.`);
  lines.push('');
  lines.push('| Group | Files |');
  lines.push('| --- | ---: |');
  for (const group of GROUPS) {
    lines.push(`| ${group.title} | ${group.files.length} |`);
  }
  lines.push('');

  for (const group of GROUPS) {
    lines.push(`## ${group.title} (${group.files.length})`);
    lines.push('');
    lines.push(group.note);
    lines.push('');
    for (const file of group.files) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function buildProjectMap() {
  return buildSections();
}

function main() {
  const check = process.argv.includes('--check');
  const content = buildProjectMap();

  if (check) {
    if (!fs.existsSync(INVENTORY_PATH)) {
      console.error('project-map: docs/blueprint/INVENTORY.md is missing. Run `npm run docs:map`.');
      process.exit(1);
    }
    const current = fs.readFileSync(INVENTORY_PATH, 'utf8');
    if (current !== content) {
      const expected = content.split('\n');
      const actual = current.split('\n');
      let line = 0;
      while (line < expected.length && line < actual.length && expected[line] === actual[line]) {
        line += 1;
      }
      console.error(
        `project-map: docs/blueprint/INVENTORY.md is stale at line ${line + 1}.\n` +
          `  expected: ${expected[line] ?? '(end of file)'}\n` +
          `  actual:   ${actual[line] ?? '(end of file)'}\n` +
          'Run `npm run docs:map` and commit the result.'
      );
      process.exit(1);
    }
    console.log('project-map: inventory is current.');
    return;
  }

  fs.mkdirSync(path.dirname(INVENTORY_PATH), { recursive: true });
  fs.writeFileSync(INVENTORY_PATH, content, 'utf8');
  const counts = GROUPS.map((group) => `${group.files.length} ${group.key}`).join(', ');
  console.log(`project-map: wrote ${relative(INVENTORY_PATH)} (${counts}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  main();
}
