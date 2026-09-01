# ForgeChess

ForgeChess is an offline-capable Setup Chess board and local AI engine.

## Features

- 39-point alternating Setup Chess placement phase
- Play vs a local engine or in two-player mode
- Responsive square board with mobile-first controls
- Tap-to-move legal move highlighting
- Undo, board flip, FEN/army copy
- Automatic local save/restore
- Local AI search in a Web Worker
- Installable PWA build through `vite-plugin-pwa`

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The project is designed to deploy directly to Vercel as a Vite app.
