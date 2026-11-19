// Live probe for the Exa web search behind the `exa-search` edge function.
//
// The edge runtime imports the SDK with an `npm:` specifier; this probe uses the
// same official package from node_modules (the dependency pinned in
// package.json) so the query the app sends can be exercised locally, against
// the real Exa API, with the same options: `type: 'auto'` + highlighted
// excerpts.
//
// Usage:
//   EXA_API_KEY=... npm run e2e:exa-search
//   EXA_API_KEY=... npm run e2e:exa-search -- "react 19 server components"
//   EXA_API_KEY=... npm run e2e:exa-search -- --category=people "CTOs at fintech startups in India"
//   EXA_API_KEY=... npm run e2e:exa-search -- --objective="pick the strongest match" "AI infra founders"
//
// `--category` accepts only the values the edge function allowlists
// (`people`, `company`). Anything else exits 1 before the call, so the probe
// cannot exercise an invented category.

// The key is read from the environment only. It is never written, logged or
// echoed by this script — only the query and the returned pages are printed.
// Exit code: 0 when Exa answered (even with zero matches), 1 when the key is
// missing or the call failed.

import Exa from 'exa-js';

const CATEGORIES = ['people', 'company'];

const args = process.argv.slice(2);
const option = (name) => {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return args[index + 1].trim();
  }
  return '';
};

const query =
  args
    .filter((arg, index) => {
      if (arg.startsWith('--')) return false;
      const previous = args[index - 1] ?? '';
      return !(previous === '--category' || previous === '--objective');
    })
    .join(' ')
    .trim() || 'latest developments in web search APIs';
const category = option('category');
const objective = option('objective');
const apiKey = (process.env.EXA_API_KEY || '').trim();

if (category && !CATEGORIES.includes(category)) {
  console.error(`--category must be one of: ${CATEGORIES.join(', ')}`);
  process.exit(1);
}

if (!apiKey) {
  console.error(
    'EXA_API_KEY is not set. Create a key at https://dashboard.exa.ai/api-keys, export it, and rerun.'
  );
  process.exit(1);
}

const exa = new Exa(apiKey);

try {
  const response = await exa.search(query, {
    type: 'auto',
    numResults: 3,
    ...(category ? { category } : {}),
    ...(objective ? { objective } : {}),
    contents: { highlights: true },
  });

  const results = response.results ?? [];
  const scope = category ? ` [category: ${category}]` : '';
  console.log(`Exa answered: ${results.length} result(s)${scope} for "${query}"`);
  for (const item of results) {
    console.log(`- ${item.title ?? '(untitled)'} — ${item.url}`);
    const highlight = Array.isArray(item.highlights) ? item.highlights[0] : '';
    if (highlight) console.log(`  ${highlight.slice(0, 240)}`);
  }
  if (results.length === 0) {
    console.warn('Exa returned no results for this query.');
  }
  process.exit(0);
} catch (err) {
  console.error('Exa search failed:', err?.name || 'Error', err?.message || '');
  process.exit(1);
}
