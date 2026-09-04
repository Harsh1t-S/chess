// Resolves Playwright from wherever it happens to be installed. It is not a
// dependency of this project: the end-to-end suite is opt-in.
import { createRequire } from 'node:module'

const CANDIDATES = [
  'playwright',
  'playwright-core',
  '@playwright/test',
  '/opt/node22/lib/node_modules/playwright/index.mjs',
  '/usr/lib/node_modules/playwright/index.mjs'
]

export async function loadChromium () {
  const require = createRequire(import.meta.url)
  for (const candidate of CANDIDATES) {
    try {
      const resolved = candidate.startsWith('/') ? candidate : require.resolve(candidate)
      const module = await import(resolved.startsWith('/') ? resolved : `file://${resolved}`)
      if (module.chromium) return module.chromium
    } catch { /* try the next one */ }
  }
  throw new Error('Playwright not found. Install it with `npm i -D playwright` and run `npx playwright install chromium`.')
}
