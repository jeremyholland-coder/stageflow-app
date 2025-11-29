import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

// CRITICAL FIX #18: Plugin to ensure correct modulepreload order
// ROOT CAUSE: Vite generates modulepreload tags in alphabetical order with function-based manualChunks
// FIX: Reorder tags to match dependency order (react-vendor BEFORE charts-vendor)
const modulePreloadOrderPlugin = () => {
  return {
    name: 'modulepreload-order-fix',
    enforce: 'post',
    transformIndexHtml(html) {
      // Extract all modulepreload tags
      const modulepreloads = [];
      const regex = /<link\s+rel="modulepreload"[^>]*>/g;
      let match;

      while ((match = regex.exec(html)) !== null) {
        modulepreloads.push(match[0]);
      }

      if (modulepreloads.length === 0) return html;

      // Sort by dependency order (not alphabetical)
      // Note: recharts is no longer split to avoid circular dependencies
      const order = ['react-vendor', 'supabase-vendor', 'icons-vendor'];
      const sorted = modulepreloads.sort((a, b) => {
        const getOrder = (tag) => {
          for (let i = 0; i < order.length; i++) {
            if (tag.includes(order[i])) return i;
          }
          return 999; // Unknown chunks go last
        };
        return getOrder(a) - getOrder(b);
      });

      // Remove all modulepreload tags from HTML
      let result = html.replace(regex, '');

      // Insert sorted modulepreload tags before first script tag
      const scriptTag = result.indexOf('<script type="module"');
      if (scriptTag !== -1) {
        const indent = '    '; // Match existing indentation
        const sortedTags = sorted.map(tag => indent + tag).join('\n');
        result = result.slice(0, scriptTag) + sortedTags + '\n' + indent + result.slice(scriptTag);
      }

      return result;
    }
  };
};

// Import version from package.json (single source of truth)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'))
const APP_VERSION = packageJson.version

// ZERO-DOWNTIME: Plugin to generate version.json for deployment tracking
const generateVersionPlugin = () => ({
  name: 'generate-version',
  closeBundle() {
    const version = {
      version: APP_VERSION, // Imported from package.json - single source of truth
      buildTime: new Date().toISOString(),
      commit: (() => {
        try {
          return execSync('git rev-parse --short HEAD').toString().trim()
        } catch {
          return 'unknown'
        }
      })(),
      branch: (() => {
        try {
          return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
        } catch {
          return 'unknown'
        }
      })()
    }

    const versionPath = path.resolve(__dirname, 'dist', 'version.json')
    fs.mkdirSync(path.dirname(versionPath), { recursive: true })
    fs.writeFileSync(versionPath, JSON.stringify(version, null, 2))
    console.error('✓ Generated version.json:', version) // Using console.error to show in production builds
  }
})

// FIX #3: Code splitting for bundle optimization (912KB → ~250KB per chunk)
export default defineConfig({
  plugins: [
    react(),
    modulePreloadOrderPlugin(), // CRITICAL: Must run AFTER Vite generates HTML (enforce: 'post')
    generateVersionPlugin(),
    // Bundle analyzer - generates stats.html to visualize bundle size
    visualizer({
      filename: './dist/stats.html',
      open: false, // Set to true to auto-open after build
      gzipSize: true,
      brotliSize: true,
      template: 'treemap' // sunburst, treemap, network
    }),
    // Sentry sourcemap upload (only in production builds with auth token)
    process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      org: process.env.SENTRY_ORG || 'stageflow',
      project: process.env.SENTRY_PROJECT || 'stageflow-crm',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false, // Disable telemetry for privacy
      sourcemaps: {
        assets: './dist/**/*.js.map',
        ignore: ['node_modules'],
        filesToDeleteAfterUpload: ['./dist/**/*.js.map'] // Delete sourcemaps after upload for security
      }
    }),
    // PWA: Enable offline support, faster loading, and installable app
    VitePWA({
      disable: process.env.NODE_ENV === 'development', // Disable in dev to avoid "Limited connectivity" warning
      registerType: 'prompt', // Changed from autoUpdate - let user control when to update
      includeAssets: ['stageflow-logo.png', 'favicon.ico'],
      manifest: {
        name: 'StageFlow - Revenue Operations Platform',
        short_name: 'StageFlow',
        description: 'AI-powered revenue operations and pipeline management',
        theme_color: '#1ABC9C',
        background_color: '#0D1F2D',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/apple-touch-icon.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/stageflow-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/stageflow-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        skipWaiting: true, // CRITICAL FIX: Auto-activate new SW to prevent 404s from stale cache
        clientsClaim: true,  // Take over clients when activated
        cleanupOutdatedCaches: true, // CRITICAL: Delete old caches automatically
        // OPT-7: PERFORMANCE FIX - Optimized service worker cache strategy
        // Separate caches by data type with appropriate strategies and TTLs
        runtimeCaching: [
          // Organizations cache: StaleWhileRevalidate for instant load + background refresh
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/organizations.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'org-cache',
              expiration: {
                maxEntries: 100, // Increased from 50
                maxAgeSeconds: 5 * 60 // 5 minutes (was 1 hour)
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Deals cache: CacheFirst for maximum speed (real-time updates via WebSocket)
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/deals.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'deals-cache',
              expiration: {
                maxEntries: 500, // Support large pipelines
                maxAgeSeconds: 10 * 60 // 10 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Team members cache
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/team_members.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'team-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 10 * 60
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Auth endpoints: NetworkOnly (never cache auth)
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/.*/i,
            handler: 'NetworkOnly'
          },
          // Generic Supabase fallback (for other tables)
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-other-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 5 * 60
              },
              cacheableResponse: {
                statuses: [0, 200]
              },
              networkTimeoutSeconds: 5
            }
          },
          // Stripe endpoints: NetworkFirst with short timeout
          {
            urlPattern: /^https:\/\/.*\.stripe\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'stripe-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60
              }
            }
          }
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/\.netlify/]
      }
    })
  ],
  server: {
    host: true,
    port: 5173
  },
  build: {
    // FIX: Use 'hidden' to generate maps for Sentry without sourceMappingURL comments
    // Prevents console errors when maps are deleted after Sentry upload
    sourcemap: 'hidden',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.* in production (1017+ statements removed)
        drop_debugger: true,
        // CRITICAL FIX #20: Prevent TDZ errors from terser reordering
        toplevel: false,  // Don't hoist declarations to top level
        hoist_funs: false, // Don't hoist function declarations
        hoist_vars: false  // Don't hoist variable declarations
      },
      mangle: {
        toplevel: false  // Don't mangle top-level names (prevents reordering)
      },
      // CRITICAL: Preserve module initialization order
      module: true,
      toplevel: false
    },
    rollupOptions: {
      output: {
        // CACHE BUSTER: Add build timestamp to force new hash generation
        assetFileNames: `assets/[name].[hash].${Date.now()}.[ext]`,
        chunkFileNames: `assets/[name].[hash].${Date.now()}.js`,
        entryFileNames: `assets/[name].[hash].${Date.now()}.js`,
        manualChunks(id) {
          // CRITICAL FIX #17: Keep supabase.js IN MAIN BUNDLE (don't split it)
          // ROOT CAUSE: Splitting supabase causes chunk loading race conditions
          // SOLUTION: Let src/lib/supabase.js stay in index.js with Proxy lazy init
          // This increases main bundle by ~2KB but eliminates ALL chunk coordination issues

          // Split vendor code to leverage browser caching + reduce main bundle
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor';
            }
            if (id.includes('@supabase/supabase-js')) {
              return 'supabase-vendor';
            }
            if (id.includes('lucide-react')) {
              return 'icons-vendor';
            }
            // CRITICAL FIX #19: DON'T split recharts - causes circular dependency with React
            // ROOT CAUSE: recharts imports React, but Vite creates circular import between chunks
            // SOLUTION: Keep recharts in main bundle to avoid chunk coordination issues
            // This increases main bundle by ~352KB but eliminates circular dependency crashes
          }
          // Don't split src/* files - keep them in main bundle
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
})
