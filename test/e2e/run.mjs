// Builds the app, serves dist, and runs every end-to-end suite against it.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const SUITES = ['rules', 'app', 'flows']
const PORT = Number(process.env.PORT || 4173)
const BASE = `http://localhost:${PORT}/`

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
  child.on('error', reject)
})

async function waitForServer (url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch { /* not up yet */ }
    await sleep(250)
  }
  return false
}

if (!process.env.FORGECHESS_URL) {
  console.log('building…')
  await run('npm', ['run', 'build'], { stdio: 'ignore' })
}

let server = null
if (!process.env.FORGECHESS_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  if (!(await waitForServer(BASE))) {
    server.kill()
    console.error(`could not start a preview server on ${BASE}`)
    process.exit(1)
  }
}

let failures = 0
try {
  for (const suite of SUITES) {
    console.log(`\n── ${suite} ──`)
    try {
      await run(process.execPath, [new URL(`./${suite}.mjs`, import.meta.url).pathname], {
        env: { ...process.env, FORGECHESS_URL: process.env.FORGECHESS_URL || BASE }
      })
    } catch {
      failures++
    }
  }
} finally {
  if (server) server.kill()
}

console.log(failures ? `\n${failures} suite(s) failed` : '\nall end-to-end suites passed')
process.exit(failures ? 1 : 0)
