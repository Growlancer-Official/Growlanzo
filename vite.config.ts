import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import vike from 'vike/plugin';
import path from 'path';
import fs from 'fs';
import { execSync } from 'node:child_process';
import { PUBLIC_PRERENDER_URLS } from './pages/prerenderUrls';

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

/**
 * Boot-splash markup injected into every built HTML file.
 *
 * Vike prerenders ONLY the public pages; every other path (dashboard, client,
 * admin, onboarding, dynamic public pages…) is served by Vercel's SPA fallback
 * which returns the prerendered `index.html` — i.e. the HOMEPAGE HTML. Before
 * React hydrates, the user would see the homepage flash (e.g. "onboarding done
 * → homepage flashes → dashboard appears"). This overlay covers those routes
 * until the app renders its first frame (App.tsx calls __growlancerBootReady).
 */
const BOOT_SPLASH_HTML = `<!-- __boot_splash_marker__ -->
<style>
  #boot-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: #FFF8EE;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.25s ease;
  }
  #boot-overlay .boot-spinner {
    width: 44px;
    height: 44px;
    border: 4px solid #d1fae5;
    border-top-color: #10b981;
    border-radius: 50%;
    animation: boot-spin 0.8s linear infinite;
  }
  @keyframes boot-spin { to { transform: rotate(360deg); } }
</style>
<script>
  (function () {
    var path = window.location.pathname;
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    // Exact list of pages that ARE statically prerendered — their SSR content
    // is correct and needs no overlay. Everything else gets the boot splash
    // until the app hydrates the real route.
    var prerendered = __PRERENDERED_URLS__;
    if (prerendered.indexOf(path) !== -1) return;
    // Non-prerendered path: the SPA fallback serves the prerendered HOMEPAGE
    // HTML. vike-react hydrates whenever #root is non-empty, which would
    // hydrate the wrong DOM (homepage markup vs dashboard React tree) and
    // crash with React hydration error #418 on every device. Clearing #root
    // makes vike-react fall back to a full client render instead — correct
    // content, no mismatch. (Crawlers get the boot splash here either way:
    // the homepage HTML served for these paths had the wrong title/canonical,
    // so it was never useful content for them.)
    var rootEl = document.getElementById('root');
    if (rootEl) rootEl.innerHTML = '';
    var div = document.createElement('div');
    div.id = 'boot-overlay';
    div.innerHTML = '<div class="boot-spinner"></div>';
    document.body.appendChild(div);
    var hidden = false;
    var hide = function () {
      if (hidden) return;
      hidden = true;
      div.style.opacity = '0';
      div.style.pointerEvents = 'none';
      window.setTimeout(function () {
        if (div.parentNode) div.parentNode.removeChild(div);
      }, 350);
    };
    window.__growlancerBootReady = hide;
    // Safety net: never trap the user behind the overlay if boot fails.
    window.setTimeout(hide, 15000);
  })();
</script>`;

/**
 * Light lock — must run before the first paint on EVERY served route.
 *
 * The site is light-only: dark mode was removed, so no device setting, saved
 * preference or stale `.dark` class may repaint a page dark. This runs in
 * <head> (the one place every prerendered page and the SPA-fallback shell pass
 * through), stripping `.dark` and pinning `color-scheme: light` before CSS
 * paints — ThemeProvider repeats it after hydration for the same reason.
 *
 * The old theme preference is deleted here rather than read: keeping it would
 * let a returning visitor's storage re-apply a theme that no longer exists.
 */
const THEME_FOUC_GUARD = `<!-- __theme_guard_marker__ -->
<script>
  (function () {
    var root = document.documentElement;
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    try {
      localStorage.removeItem('growlancer-theme');
    } catch (e) {
      // Storage blocked (private mode) — nothing to clean up.
    }
  })();
</script>`;

/**
 * Vite plugin: inject the theme guard (into <head>) and the boot-splash markup
 * (into <body>) of every built HTML file.
 *
 * Runs in `closeBundle` AFTER the vercel-output copy, so it injects into
 * `dist/client/**\/*.html` (the source of truth that scripts/build.mjs then
 * copies to `dist/`). Idempotent via the marker comments.
 */
function bootSplashInjectPlugin(): Plugin {
  return {
    name: 'boot-splash-inject',
    closeBundle() {
      const clientDir = path.resolve(__dirname, 'dist/client');
      if (!fs.existsSync(clientDir)) {
        console.warn('[boot-splash] dist/client not found — skipping injection');
        return;
      }
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (entry.name.endsWith('.html')) files.push(p);
        }
      };
      walk(clientDir);
      let guarded = 0;
      for (const file of files) {
        let html = fs.readFileSync(file, 'utf8');
        const original = html;
        // <head> first: the class has to be on <html> before anything paints.
        if (!html.includes('__theme_guard_marker__') && html.includes('</head>')) {
          html = html.replace('</head>', THEME_FOUC_GUARD + '\n</head>');
          guarded++;
        }
        if (!html.includes('__boot_splash_marker__') && html.includes('</body>')) {
          html = html.replace('</body>', bootSplashHtml + '\n</body>');
        }
        if (html !== original) fs.writeFileSync(file, html);
      }
      console.log(
        `[boot-splash] Injected the light-only theme guard into ${guarded} HTML file(s); injected the boot splash into ${files.length}`
      );
    },
  };
}

const legalLastUpdatedIso = getLegalDocsLastUpdatedIso();

// Inject the shared prerender URL list into the inline boot-splash script.
// The overlay is skipped for exactly the URLs Vike prerenders (see
// pages/prerenderUrls.ts) — one source of truth, so the two can't drift.
const bootSplashHtml = BOOT_SPLASH_HTML.replace(
  '__PRERENDERED_URLS__',
  JSON.stringify([...PUBLIC_PRERENDER_URLS])
);

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
    // ─── Boot splash (SPA-fallback flash guard) ────────────
    // Injects the pre-hydration overlay into every built HTML file so the
    // prerendered homepage never flashes on non-prerendered routes.
    bootSplashInjectPlugin(),
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
