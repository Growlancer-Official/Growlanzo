import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A 204 response is a "null body status" in the Fetch spec: constructing
 * `new Response('ok', { status: 204 })` throws a TypeError, so the handler
 * never returns and the runtime answers 500 to every CORS preflight.
 *
 * That is exactly what happened to `submit-report`: OPTIONS returned
 * `500 Internal Server Error` in production while GET/POST worked, so the
 * browser preflight failed and the Report-a-bug form was dead. The bug is
 * invisible to typecheck, lint and the unit suite because it only fires at
 * runtime.
 *
 * This guard reads every edge function and fails if a null-body status is
 * constructed with a body.
 */

const FUNCTIONS_DIR = path.join(process.cwd(), 'supabase', 'functions');

function listFunctionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFunctionSources(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments so prose about the bug cannot trip the guard. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('edge function CORS responses', () => {
  const files = listFunctionSources(FUNCTIONS_DIR);

  it('walks every edge function source', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('never builds a null-body status response with a body', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      // Find every `new Response(` whose first argument is a string literal,
      // then inspect the following characters for a null-body status.
      const literalFirstArg = /new Response\(\s*(['"`])/g;
      let match: RegExpExecArray | null;
      while ((match = literalFirstArg.exec(source)) !== null) {
        const window = source.slice(match.index, match.index + 240);
        if (/status:\s*(101|204|205|304)\b/.test(window)) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${path.relative(process.cwd(), file)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
