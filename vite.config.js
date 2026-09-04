import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false
  },
  worker: {
    format: 'es'
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            // Board and piece artwork is fetched from the theme CDN, then kept
            // locally so the installed app still renders offline.
            urlPattern: /^https:\/\/(www\.chess\.com\/chess-themes|images\.chesscomfiles\.com\/chess-themes)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'forgechess-themes',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Stockfish is fetched on demand for analysis; once it has been
            // pulled it stays available offline.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/stockfish/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'forgechess-stockfish',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'forgechess-fonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: 'ForgeChess — Classic, Setup and Fog of War chess',
        short_name: 'ForgeChess',
        description: 'Play three chess variants against an engine that reviews its own blunders after every game and stops repeating them.',
        theme_color: '#302e2b',
        background_color: '#302e2b',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        categories: ['games', 'board'],
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      }
    })
  ]
})
