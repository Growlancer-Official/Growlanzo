import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Respan Gateway wiring (2026-11-07).
 *
 * Every Growlanzo AI feature funnels through one shared `callAI()` in
 * `supabase/functions/_shared/ai.ts`. The gateway is an optional local router in
 * front of it: set `AI_GATEWAY_URL` and the app asks for logical routes instead
 * of a vendor model, so provider order, retries and hedging live in
 * `gateway.toml`. Three things must not silently rot:
 *
 *   • the committed config keeps listening on LOOPBACK only — the process spends
 *     the developer's provider key and has no client keys, so a public bind
 *     would hand it to anyone who can reach the port;
 *   • gateway mode stays opt-in: production must keep calling `AI_BASE_URL`
 *     directly, because Supabase Cloud cannot reach a developer's loopback;
 *   • the route names in the config and the defaults in the client stay in sync,
 *     or every AI feature 404s at the gateway.
 *
 * The routing behaviour itself is proven by `npm run e2e:gateway`
 * (`scripts/e2e/respan-gateway-smoke.mjs`) against a real gateway process.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CONFIG = read('gateway.toml');
const AI_SHARED = read('supabase/functions/_shared/ai.ts');
const REQUIREMENTS = read('requirements-gateway.txt');
const ENV_EXAMPLE = read('.env.example');
const BACKEND_DOC = read('docs/blueprint/BACKEND.md');
const PKG = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('gateway.toml', () => {
  it('listens on loopback only and sets no client keys', () => {
    expect(CONFIG).toMatch(/^listen\s*=\s*"127\.0\.0\.1:\d+"/m);
    // No client keys ⇒ the only safe bind is loopback; assert both halves.
    expect(CONFIG).toContain('LOCAL ONLY');
    expect(CONFIG.replace(/^\s*#.*$/gm, '')).not.toMatch(/^\s*client_keys\s*=/m);
  });

  it('reuses the existing AI_API_KEY secret instead of a new credential', () => {
    expect(CONFIG).toContain('key    = "env:AI_API_KEY"');
    // A literal key value must never be committed.
    expect(CONFIG).not.toMatch(/key\s*=\s*"(?!env:)[^"]{16,}"/);
  });

  it('declares both routes the AI client asks for', () => {
    expect(CONFIG).toContain('[routes.growlanzo-chat]');
    expect(CONFIG).toContain('[routes.growlanzo-priority]');
    // Fallback must be real: at least one retry/backoff or hedge setting.
    expect(CONFIG).toMatch(/^\s*(tries|hedge|backoff)\s*=/m);
  });
});

describe('AI client', () => {
  it('derives the base URL from AI_GATEWAY_URL and keeps the direct default', () => {
    expect(AI_SHARED).toContain("Deno.env.get('AI_GATEWAY_URL')");
    expect(AI_SHARED).toContain('${AI_GATEWAY_URL}/v1');
    expect(AI_SHARED).toContain("'https://openrouter.ai/api/v1'");
  });

  it('defaults to the route names only in gateway mode', () => {
    expect(AI_SHARED).toContain("AI_VIA_GATEWAY ? 'growlanzo-chat' : 'deepseek/deepseek-chat-v3-0324'");
    expect(AI_SHARED).toContain("AI_VIA_GATEWAY && !RAW_MODEL ? 'growlanzo-priority' : AI_MODEL");
  });

  it('does not forward the OpenRouter-only provider field through the gateway', () => {
    expect(AI_SHARED).toContain('if (!AI_VIA_GATEWAY) {');
    const guard = AI_SHARED.slice(AI_SHARED.indexOf('if (!AI_VIA_GATEWAY) {'));
    expect(guard.slice(0, 200)).toContain("body.provider = { sort: 'latency', allow_fallbacks: true };");
  });
});

describe('dependency manifest and docs', () => {
  it('pins the gateway version in a wheel-only requirements file', () => {
    expect(REQUIREMENTS).toContain('respan-gateway==0.3.0');
    expect(REQUIREMENTS).toContain('--only-binary=:all:');
    // "Pinned installs (install exactly these)": no other package is declared.
    const packages = REQUIREMENTS.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(packages).toEqual(['respan-gateway==0.3.0']);
  });

  it('documents AI_GATEWAY_URL as an empty, local-only knob', () => {
    expect(ENV_EXAMPLE).toContain('AI_GATEWAY_URL=');
    expect(ENV_EXAMPLE).not.toMatch(/AI_GATEWAY_URL=\S+/);
  });

  it('links the gateway guide from the backend doc', () => {
    expect(BACKEND_DOC).toContain('https://github.com/respanai/respan-gateway');
    expect(BACKEND_DOC).toContain('growlanzo-chat');
    expect(BACKEND_DOC).toContain('AI_GATEWAY_URL');
  });

  it('exposes the smoke check as an npm script', () => {
    expect(PKG.scripts['e2e:gateway']).toBe('node scripts/e2e/respan-gateway-smoke.mjs');
    expect(fs.existsSync(path.join(ROOT, 'scripts/e2e/respan-gateway-smoke.mjs'))).toBe(true);
  });
});
