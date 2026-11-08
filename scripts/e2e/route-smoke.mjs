// Live route smoke test: every SPA segment must still answer 200 in production.
//
// Why this exists: the soft-404 fix (2026-11-08) replaced a blanket
// `/* -> /index.html 200` with an **enumerated allowlist** in `vercel.json`,
// `server.js` and `spa-route-segments.json`. That makes a real 404 possible --
// and creates a new failure mode that no unit test can see: a route that exists
// in `App.tsx` but is missing from the allowlist answers **404 in production**
// while every local check stays green. That is a worse bug than the soft-404,
// because it breaks a working page for real visitors.
//
// So this walks the deployed host, one request per segment, and fails loudly on
// anything that is not 200. It also runs a **negative control**: a random
// unknown path must return 404 carrying `noindex`. Without that half, the script
// would happily pass if the blanket rewrite came back.
//
// A 200 alone is not proof the page works: a 200 that serves an empty body, a
// 5xx error page, or JSON would still be broken. Every response must also be
// `text/html` and contain the app root the React bundle mounts into.
//
// Usage:
//   node scripts/e2e/route-smoke.mjs                       # production
//   SMOKE_BASE_URL=http://localhost:4174 node scripts/e2e/route-smoke.mjs
//   node scripts/e2e/route-smoke.mjs --base=https://growlanzo.com --timeout=20000
//
// No credentials, no accounts, no writes: read-only GETs against public URLs.
// Exit code 0 = every known route 200 and unknown paths still 404.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SEGMENTS_FILE = path.join(ROOT, 'spa-route-segments.json');

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    })
);

const BASE = (args.base || process.env.SMOKE_BASE_URL || 'https://www.growlanzo.com').replace(
  /\/+$/,
  ''
);
const TIMEOUT_MS = Number(args.timeout || process.env.SMOKE_TIMEOUT_MS || 20000);
const CONCURRENCY = Number(args.concurrency || 6);
const ATTEMPTS = Number(args.attempts || 2);

// Node leaves process.exitCode `undefined` until something sets it, so an
// explicit 0 makes the "did anything fail?" check below meaningful.
process.exitCode = 0;

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

function fail(message) {
  console.error(`${RED}✗ ${message}${RESET}`);
  process.exitCode = 1;
}

const segments = (() => {
  if (!fs.existsSync(SEGMENTS_FILE)) {
    fail(`missing ${path.relative(ROOT, SEGMENTS_FILE)} — the allowlist is gone`);
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(SEGMENTS_FILE, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.segments;
  if (!Array.isArray(list) || list.length === 0) {
    fail('spa-route-segments.json has no segments — a smoke test over nothing is not a pass');
    return [];
  }
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
})();

/** GET with a timeout, following redirects, retrying transient failures only. */
async function probe(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'growlanzo-route-smoke/1.0', accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text();
      const result = {
        status: res.status,
        ms: Date.now() - started,
        contentType: res.headers.get('content-type') || '',
        body,
        finalUrl: res.url,
      };
      // 5xx is usually a cold start or a rolling deploy; retry once. A 4xx is
      // an answer, not a hiccup, so it is returned immediately.
      if (res.status >= 500 && attempt < ATTEMPTS) {
        lastError = `HTTP ${res.status} (attempt ${attempt})`;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return { status: 0, ms: 0, contentType: '', body: '', finalUrl: url, error: lastError };
}

const failures = [];
const results = [];

function record(name, url, result, expected) {
  if (result.status === expected) {
    results.push({ name, ...result });
    console.log(
      `  ${GREEN}✓${RESET} ${String(result.status)}  ${name.padEnd(24)} ${DIM}${result.ms}ms${RESET}`
    );
    return true;
  }

  failures.push({
    name,
    url,
    expected,
    status: result.status,
    error: result.error,
  });
  const detail = result.error ? ` (${result.error})` : '';
  console.log(
    `  ${RED}✗${RESET} ${String(result.status || 'ERR')}  ${name.padEnd(24)} ${DIM}expected ${expected}${detail}${RESET}`
  );
  return false;
}

async function run() {
  console.log(`\nGrowlanzo route smoke — ${BASE}  (${segments.length} segments)\n`);

  // --- known routes: every segment must be served ---------------------------
  const queue = [...segments];
  const worker = async () => {
    for (;;) {
      const segment = queue.shift();
      if (!segment) return;

      const url = `${BASE}/${segment}`;
      const result = await probe(url);
      const ok = record(`/${segment}`, url, result, 200);

      if (ok) {
        // A 200 is not enough: the response has to be the SPA shell, otherwise
        // the page is "available" but blank.
        if (!/text\/html/i.test(result.contentType)) {
          fail(`/${segment} returned 200 but content-type is "${result.contentType}"`);
        } else if (!/id="root"/.test(result.body)) {
          fail(`/${segment} returned 200 but the body has no app root (#root)`);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  // --- root and the negative control ---------------------------------------
  console.log('');
  record('/', `${BASE}/`, await probe(`${BASE}/`), 200);

  const unknown = `/route-smoke-${Date.now().toString(36)}-does-not-exist`;
  const unknownResult = await probe(`${BASE}${unknown}`);
  const unknownOk = record(unknown, `${BASE}${unknown}`, unknownResult, 404);
  if (unknownOk && !/noindex/i.test(unknownResult.body)) {
    fail(`${unknown} returned 404 but the body is missing the noindex marker`);
  }

  // --- summary --------------------------------------------------------------
  const slowest = [...results].sort((a, b) => b.ms - a.ms)[0];
  console.log(`\n${DIM}${'─'.repeat(60)}${RESET}`);
  console.log(`checked : ${results.length + failures.length} URLs against ${BASE}`);
  console.log(`passed  : ${GREEN}${results.length}${RESET}`);
  console.log(`failed  : ${failures.length ? RED : GREEN}${failures.length}${RESET}`);
  if (slowest) console.log(`slowest : ${slowest.name} ${slowest.ms}ms`);
  if (failures.length === 0 && !process.exitCode) {
    console.log(`${GREEN}OK — every known route 200, unknown paths still 404${RESET}\n`);
    return;
  }

  if (failures.length) {
    console.log(`\n${RED}Broken routes:${RESET}`);
    for (const f of failures) {
      const got = f.status || f.error || 'no response';
      console.log(`  ${f.name} → ${got} (expected ${f.expected})  ${DIM}${f.url}${RESET}`);
    }
    console.log(
      `\n${DIM}If a route exists in src/app/App.tsx but 404s here, it is missing from` +
        ` spa-route-segments.json and vercel.json. src/test/soft404Routing.test.ts` +
        ` fails on that drift before a deploy; this script catches the case where` +
        ` the deploy itself did not pick the change up.${RESET}\n`
    );
  }

  process.exitCode = 1;
}

await run();
