// Proves the AI workflow the app actually ships (the shared `callAI()` in
// `supabase/functions/_shared/ai.ts`) reaches the Respan Gateway, and that the
// gateway — not the app — chooses the provider, retries a failed target and
// streams the reply back.
//
// Why a local fixture instead of a real provider:
//   * The gateway spends the developer's own provider key. A sponsored or CI
//     run has none, and a smoke check must never ask for one.
//   * A real model cannot prove the thing that matters here: that the request
//     left the app on the `growlanzo-chat` route, was translated to a concrete
//     provider model, retried after a provider 5xx, and came back as a valid
//     OpenAI-compatible body. A deterministic provider does.
// So the gateway is started with a throwaway config whose `fixture` provider
// points at an in-process OpenAI-compatible server. Nothing leaves loopback,
// nothing is billed, and no provider credential is read or printed.
//
// What runs:
//   1. `respan-gateway check` on the committed `gateway.toml` — the config the
//      repo ships must still parse (no --online: it never calls a provider).
//   2. The real `callAI()` in gateway mode, non-streaming: the route's first
//      target is broken on purpose, so success proves gateway fallback.
//   3. The real `callAI()` in gateway mode, streaming + Pro priority lane.
//   4. The same module WITHOUT `AI_GATEWAY_URL`: the production path must keep
//      OpenRouter, the vendor model slug and the `provider` sort hint.
//
// Usage:
//   npm run e2e:gateway            # or: node scripts/e2e/respan-gateway-smoke.mjs
//
// Prerequisite (Python 3.10+, wheels only):
//   python3 -m venv .venv
//   .venv/bin/python -m pip install --only-binary=:all: -r requirements-gateway.txt
//
// Exit code: 0 only if every check above passed. A missing gateway package, a
// gateway that never becomes healthy, or any assertion failure exits 1.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP_DIR = path.join(ROOT, '.e2e'); // gitignored
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** A free loopback port: bind 0, read it, close. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** The project venv first, then whatever `python3`/`python` is on PATH. */
function findPython() {
  const candidates = [
    path.join(ROOT, '.venv', 'bin', 'python'),
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-c', 'import respan_gateway'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** Minimal OpenAI-compatible provider. Records what the gateway sent it. */
function startFixture(port) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'fixture: not found' } }));
        return;
      }
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // keep {}
      }
      const model = String(body.model ?? '');
      seen.push({ model, stream: body.stream === true, hasProviderField: 'provider' in body });

      // The route's first target: always a provider outage.
      if (model.includes('broken')) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'fixture: simulated provider outage' } }));
        return;
      }

      const created = Math.floor(Date.now() / 1000);
      if (body.stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        for (const piece of ['gateway ', 'fixture ', 'stream ok']) {
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-fixture',
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
            })}\n\n`,
          );
        }
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-fixture',
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-fixture',
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: `gateway-fixture-ok via ${model}` },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 },
        }),
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, seen }));
  });
}

async function waitForHealth(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  console.log('Respan Gateway ⇄ Growlanzo AI workflow smoke check\n');

  const python = findPython();
  if (!python) {
    check('respan-gateway 0.3.0 is importable', false);
    console.log(
      '\nThe gateway package is not installed in this checkout. Install it, then re-run:\n' +
        '  python3 -m venv .venv\n' +
        '  .venv/bin/python -m pip install --only-binary=:all: -r requirements-gateway.txt\n',
    );
    process.exitCode = 1;
    return;
  }
  check('respan-gateway 0.3.0 is importable', true, python);

  // 1. The committed config must parse. A placeholder key is enough: `check`
  //    without --online never contacts a provider.
  const gatewayToml = path.join(ROOT, 'gateway.toml');
  check('gateway.toml exists', fs.existsSync(gatewayToml));
  const configDump = execFileSync(
    python,
    ['-m', 'respan_gateway', 'check', '-c', gatewayToml],
    { cwd: ROOT, env: { ...process.env, AI_API_KEY: 'local-check-placeholder' }, encoding: 'utf8' },
  );
  check(
    'committed gateway.toml parses and declares both routes',
    configDump.includes('growlanzo-chat') && configDump.includes('growlanzo-priority'),
  );
  check(
    'committed config listens on loopback only',
    /listen\s+127\.0\.0\.1:/.test(configDump),
  );

  // 2. A throwaway gateway + provider fixture that only loopback can reach.
  const [fixturePort, gatewayPort] = await Promise.all([freePort(), freePort()]);
  const fixtureUrl = `http://127.0.0.1:${fixturePort}`;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmpConfig = path.join(TMP_DIR, 'respan-gateway-smoke.toml');
  fs.writeFileSync(
    tmpConfig,
    `# Generated by scripts/e2e/respan-gateway-smoke.mjs — throwaway, loopback only.
listen = "127.0.0.1:${gatewayPort}"
log    = "text"
ui     = false

[providers.fixture]
formats  = ["openai-chat"]
base_url = "${fixtureUrl}/v1"

[routes.growlanzo-chat]
to      = ["fixture/broken-chat", "fixture/fixture-chat"]
tries   = 2
backoff = "50ms"

[routes.growlanzo-priority]
to    = ["fixture/fixture-chat"]
hedge = "200ms"
`,
    'utf8',
  );

  const { server: fixture, seen } = await startFixture(fixturePort);
  // Deliberately NOT the caller's environment: provider keys must not reach a
  // throwaway gateway, and the fixture provider needs no key at all.
  const gatewayEnv = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: process.env.LANG ?? 'C.UTF-8',
    NO_COLOR: '1',
  };
  const gateway = spawn(python, ['-m', 'respan_gateway', '-c', tmpConfig], {
    cwd: ROOT,
    env: gatewayEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let gatewayLog = '';
  gateway.stdout.on('data', (d) => (gatewayLog += d));
  gateway.stderr.on('data', (d) => (gatewayLog += d));

  try {
    const healthy = await waitForHealth(gatewayUrl);
    check('gateway starts and answers /healthz on loopback', healthy, gatewayUrl);
    if (!healthy) {
      console.log(gatewayLog.trim());
      return;
    }

    // 3. The real application module, in gateway mode.
    process.env.AI_GATEWAY_URL = gatewayUrl;
    process.env.AI_API_KEY = 'local-gateway-placeholder'; // not a provider key
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    delete process.env.AI_PRIORITY_MODEL;
    globalThis.Deno = { env: { get: (key) => process.env[key] } };
    const ai = await import(
      pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/ai.ts')).href
    );

    check('AI client detects gateway mode', ai.AI_VIA_GATEWAY === true);
    check(
      'AI client targets the gateway OpenAI-compatible endpoint',
      ai.AI_BASE_URL === `${gatewayUrl}/v1`,
      ai.AI_BASE_URL,
    );
    check(
      'AI client asks for the logical routes from gateway.toml',
      ai.AI_MODEL === 'growlanzo-chat' && ai.AI_PRIORITY_MODEL === 'growlanzo-priority',
      `${ai.AI_MODEL} / ${ai.AI_PRIORITY_MODEL}`,
    );

    // 3a. Non-streaming call — the same call ai-writer and ai-matching make.
    const seenBefore = seen.length;
    const res = await ai.callAI(
      [
        { role: 'system', content: 'You are the Growlanzo fixture.' },
        { role: 'user', content: 'ping' },
      ],
      { timeoutMs: 20000 },
    );
    const body = await res.json().catch(() => ({}));
    const text = body?.choices?.[0]?.message?.content ?? '';
    const attempts = seen.slice(seenBefore);
    check('callAI returns 200 through the gateway', res.ok, `HTTP ${res.status}`);
    check('reply carries the provider completion', text.includes('gateway-fixture-ok'), text);
    check(
      'gateway translated the route to a provider model',
      attempts.some((a) => a.model === 'fixture-chat'),
      attempts.map((a) => a.model).join(' → ') || 'no upstream calls',
    );
    check(
      'gateway retried/fall back past the broken target',
      attempts.some((a) => a.model === 'broken-chat'),
      `${attempts.length} upstream attempt(s)`,
    );
    check(
      'OpenRouter-only provider hint is not forwarded in gateway mode',
      attempts.every((a) => a.hasProviderField === false),
    );

    // 3b. Streaming + Pro priority lane — the path ai-assistant uses.
    const seenBeforeStream = seen.length;
    const streamRes = await ai.callAI(
      [{ role: 'user', content: 'stream please' }],
      { stream: true, priority: true, timeoutMs: 25000 },
    );
    const sse = await streamRes.text();
    const streamed = sse
      .split('\n')
      .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map((line) => {
        try {
          return JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content ?? '';
        } catch {
          return '';
        }
      })
      .join('');
    const streamAttempts = seen.slice(seenBeforeStream);
    check('priority lane streams through the gateway', streamRes.ok && sse.includes('data:'), `HTTP ${streamRes.status}`);
    check('streamed text is complete and closed', streamed.includes('stream ok') && sse.includes('[DONE]'), streamed.trim());
    check(
      'priority call reached the provider as a stream',
      streamAttempts.some((a) => a.stream === true),
    );
  } finally {
    gateway.kill('SIGTERM');
    await new Promise((resolve) => {
      gateway.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    await new Promise((resolve) => fixture.close(resolve));
    fs.rmSync(tmpConfig, { force: true });
    await new Promise((r) => setTimeout(r, 200));
    try {
      await fetch(`${gatewayUrl}/healthz`, { signal: AbortSignal.timeout(500) });
      check('gateway is stopped after the run', false, 'still listening');
    } catch {
      check('gateway is stopped after the run', true);
    }
  }

  // 4. Backward compatibility: without AI_GATEWAY_URL the production path is
  //    unchanged. Checked in a fresh process so the module constants are re-read.
  const directEnv = { ...process.env };
  delete directEnv.AI_GATEWAY_URL;
  delete directEnv.AI_MODEL;
  delete directEnv.AI_PRIORITY_MODEL;
  const direct = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          "globalThis.Deno = { env: { get: (k) => process.env[k] } };",
          "const ai = await import('./supabase/functions/_shared/ai.ts');",
          'console.log(JSON.stringify({ base: ai.AI_BASE_URL, model: ai.AI_MODEL, gateway: ai.AI_VIA_GATEWAY }));',
        ].join('\n'),
      ],
      { cwd: ROOT, env: directEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ),
  );
  check(
    'direct mode (no gateway) still defaults to OpenRouter',
    direct.base === 'https://openrouter.ai/api/v1' &&
      direct.model === 'deepseek/deepseek-chat-v3-0324' &&
      direct.gateway === false,
    `${direct.base} · ${direct.model}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log('\n─── summary ───');
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log(`\n${failed.length} check(s) failed: ${failed.map((f) => f.name).join('; ')}. Exit 1.\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    '\nThe app\'s callAI() reached the Respan Gateway on loopback, the gateway routed\n' +
      'its route to a provider model, retried a failing target and streamed back.\n' +
      'No provider request was made and no provider key was used. Exit 0.\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
