import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ForgeChess — Offline Setup Chess Engine',
        short_name: 'ForgeChess',
        description: 'Build a 39-point army and play Setup Chess against a local AI engine.',
        theme_color: '#11110f',
        background_color: '#11110f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }]
      }
    })
  ]
})
