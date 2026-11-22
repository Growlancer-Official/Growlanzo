import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import vike from 'vike/plugin';
import path from 'path';
import fs from 'fs';
import { execSync } from 'node:child_process';

const LEGAL_PAGE_PATHS = [
  'src/pages/CookiesPage.tsx',
  'src/pages/PrivacyPage.tsx',
  'src/pages/TermsPage.tsx',
] as const;

/** Latest commit date (UTC) touching any bundled legal page — updates only when those files change. */
function getLegalDocsLastUpdatedIso(): string {
  try {
    execSync('git rev-parse --verify HEAD', {
      cwd: path.resolve(__dirname),
      stdio: 'ignore',
    });

    const out = execSync(`git log -1 --format=%cs -- ${LEGAL_PAGE_PATHS.join(' ')}`, {
      encoding: 'utf8',
      cwd: path.resolve(__dirname),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    // No git, empty repo, shallow clone without history, etc.
  }
  return new Date().toISOString().slice(0, 10); // Current date as fallback
}

/**
 * Vite plugin: copies `dist/client/` → `dist/` after build completes.
 *
 * Vike (SSR/prerender) outputs client files to `dist/client/`. Vercel's
 * Vite framework preset expects `index.html` at `dist/` for its SPA
 * rewrite rules. This plugin bridges the gap — it runs in the
 * `closeBundle` hook (fires after Rollup finishes) so the copy happens
 * regardless of whether Vercel invokes `vite build` directly or via
 * `npm run build`.
 *
 * The copy is recursive and only copies files that exist — it does
 * NOT delete anything from `dist/` or `dist/client/`.
 */
function vercelOutputWorkaroundPlugin(): Plugin {
  return {
    name: 'vercel-output-workaround',
    closeBundle() {
      const src = path.resolve(__dirname, 'dist/client');
      const dest = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(src)) {
        console.warn('[vercel-output] dist/client not found — skipping copy');
        return;
      }
      console.log('[vercel-output] Copying dist/client/ → dist/...');
      copyRecursiveSync(src, dest);
      console.log('[vercel-output] Done — dist/ now mirrors dist/client/');
    },
  };
}

/** Recursively copy files from `srcDir` to `destDir` (files only, no top-level dir). */
function copyRecursiveSync(srcDir: string, destDir: string): void {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const legalLastUpdatedIso = getLegalDocsLastUpdatedIso();

export default defineConfig({
  define: {
    __LEGAL_LAST_UPDATED_ISO__: JSON.stringify(legalLastUpdatedIso),
  },
  plugins: [
    vike(),
    react(),

    // ─── Vercel Vite Preset Workaround ────────────────────
    // Vike outputs to `dist/client/` but Vercel's Vite framework preset
    // expects `index.html` at `dist/`. This plugin copies the client
    // build output to `dist/` after every build so the Vite preset's
    // SPA rewrite finds `index.html` regardless of overridden settings.
    vercelOutputWorkaroundPlugin(),
    // Bundle visualizer — run `npx vite build` and open stats.html
    // Removed dynamic import to avoid build warnings
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    cors: true,
    hmr: false,
    // Dev-only: allow one extra hostname per process (e.g. a cloud preview
    // domain) without committing a hostname to the repo. Vite 8 no longer
    // reads __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, so this is the supported
    // way to reach the dev server through a forwarded preview host.
    allowedHosts: process.env.VITE_DEV_ALLOWED_HOST ? [process.env.VITE_DEV_ALLOWED_HOST] : undefined,
    watch: {
      usePolling: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@features': path.resolve(__dirname, './src/features'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@types': path.resolve(__dirname, './src/types'),
      '@layouts': path.resolve(__dirname, './src/layouts'),
      '@pages': path.resolve(__dirname, './src/pages'),

    },
  },
  build: {
    // Target modern browsers for smaller bundles (es2020 supports >95% of users)
    target: 'es2020',
    // Enable CSS minification for smaller stylesheets
    cssMinify: true,
    // Enable source maps for production debugging (but not for end users)
    sourcemap: false,
    // Chunk size warnings at 500KB (down from default 1MB)
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core & router
          if (id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          // Supabase
          if (id.includes('node_modules/@supabase/')) {
            return 'vendor-supabase';
          }
          // UI utilities
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-ui';
          }

        },
      },
    },
  },
  // test config removed — using production build only
});
