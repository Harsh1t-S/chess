// Sound effects. The real chess.com samples are loaded from their CDN at
// runtime (media playback needs no CORS headers, unlike WebAudio decoding) and
// cached by the service worker. A synthesised set stands in when they cannot
// load, so an offline install still has feedback for every event.
const SOUND_BASE = 'https://www.chess.com/sounds/_MP3_/default'

const SAMPLES = {
  moveSelf: 'move-self',
  moveOpponent: 'move-opponent',
  capture: 'capture',
  castle: 'castle',
  check: 'move-check',
  promote: 'promote',
  gameStart: 'game-start',
  gameEnd: 'game-end',
  illegal: 'illegal',
  lowTime: 'tenseconds',
  premove: 'premove'
}

const POOL_SIZE = 3
const pools = new Map()
const ready = new Set()
let loaded = false
let enabled = true
let volume = 0.5
let context = null

// --- sample playback --------------------------------------------------------

function makePool (file) {
  const nodes = []
  for (let i = 0; i < POOL_SIZE; i++) {
    const audio = new Audio(`${SOUND_BASE}/${file}.mp3`)
    audio.preload = 'auto'
    audio.volume = volume
    audio.addEventListener('canplaythrough', () => ready.add(file), { once: true })
    nodes.push(audio)
  }
  return { nodes, index: 0 }
}

export function preloadSounds () {
  if (loaded || typeof Audio === 'undefined') return
  loaded = true
  for (const file of Object.values(SAMPLES)) {
    try { pools.set(file, makePool(file)) } catch { /* fall back to the synth */ }
  }
}

function playSample (name) {
  const file = SAMPLES[name]
  if (!file || !ready.has(file)) return false
  const pool = pools.get(file)
  if (!pool) return false
  const audio = pool.nodes[pool.index]
  pool.index = (pool.index + 1) % pool.nodes.length
  try {
    audio.volume = volume
    audio.currentTime = 0
    const played = audio.play()
    if (played && typeof played.catch === 'function') played.catch(() => {})
    return true
  } catch { return false }
}

// --- synthesised fallback ---------------------------------------------------
// Tuned to read as wood on wood rather than as a beep: a short filtered noise
// burst for the knock, with a low body tone underneath.

function ensureContext () {
  if (context) return context
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  context = new Ctor()
  return context
}

function knock ({ gain = 0.5, decay = 0.075, tone = 210, bright = 2100, delay = 0 } = {}) {
  const ctx = ensureContext()
  if (!ctx) return
  const start = ctx.currentTime + delay
  const frames = Math.max(1, Math.floor(ctx.sampleRate * decay))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 5)
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.setValueAtTime(bright, start)
  band.Q.setValueAtTime(0.9, start)
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(gain * volume, start)
  source.connect(band).connect(noiseGain).connect(ctx.destination)
  source.start(start)

  const body = ctx.createOscillator()
  const bodyGain = ctx.createGain()
  body.type = 'sine'
  body.frequency.setValueAtTime(tone, start)
  body.frequency.exponentialRampToValueAtTime(Math.max(60, tone * 0.6), start + decay)
  bodyGain.gain.setValueAtTime(0.0001, start)
  bodyGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.5 * volume), start + 0.006)
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + decay * 1.4)
  body.connect(bodyGain).connect(ctx.destination)
  body.start(start)
  body.stop(start + decay * 1.6)
}

function chime ({ frequency, duration = 0.12, gain = 0.22, delay = 0, type = 'triangle' } = {}) {
  const ctx = ensureContext()
  if (!ctx) return
  const start = ctx.currentTime + delay
  const oscillator = ctx.createOscillator()
  const amp = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * volume), start + 0.01)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(amp).connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

const SYNTH = {
  moveSelf: () => knock({ gain: 0.5, decay: 0.07, tone: 220, bright: 2200 }),
  moveOpponent: () => knock({ gain: 0.45, decay: 0.075, tone: 175, bright: 1750 }),
  capture: () => { knock({ gain: 0.62, decay: 0.11, tone: 130, bright: 1300 }); knock({ gain: 0.3, decay: 0.06, tone: 190, bright: 2400, delay: 0.02 }) },
  castle: () => { knock({ gain: 0.45, decay: 0.06, tone: 210, bright: 2000 }); knock({ gain: 0.42, decay: 0.07, tone: 190, bright: 1900, delay: 0.085 }) },
  check: () => { knock({ gain: 0.4, decay: 0.06, tone: 240, bright: 2600 }); chime({ frequency: 1050, duration: 0.12, gain: 0.16, delay: 0.02 }) },
  promote: () => { knock({ gain: 0.35, decay: 0.06, tone: 240, bright: 2400 }); chime({ frequency: 700, duration: 0.1, gain: 0.16, delay: 0.03 }); chime({ frequency: 1040, duration: 0.14, gain: 0.16, delay: 0.1 }) },
  gameStart: () => { chime({ frequency: 520, duration: 0.12, gain: 0.16 }); chime({ frequency: 780, duration: 0.16, gain: 0.16, delay: 0.09 }) },
  gameEnd: () => { chime({ frequency: 620, duration: 0.16, gain: 0.18 }); chime({ frequency: 465, duration: 0.24, gain: 0.18, delay: 0.13 }) },
  illegal: () => chime({ frequency: 165, duration: 0.13, gain: 0.16, type: 'sawtooth' }),
  lowTime: () => chime({ frequency: 980, duration: 0.07, gain: 0.15, type: 'square' }),
  premove: () => knock({ gain: 0.28, decay: 0.04, tone: 300, bright: 3000 })
}

// --- public API -------------------------------------------------------------

export function setSoundEnabled (value) { enabled = !!value }
export function setVolume (value) {
  volume = Math.max(0, Math.min(1, value))
  for (const pool of pools.values()) for (const node of pool.nodes) node.volume = volume
}

export function unlockAudio () {
  const ctx = ensureContext()
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
  preloadSounds()
}

export function play (name) {
  if (!enabled) return
  if (playSample(name)) return
  const fallback = SYNTH[name]
  if (fallback) fallback()
}

export const sounds = new Proxy({}, {
  get: (_target, name) => () => play(String(name))
})

// Which cue an event deserves, in the order chess.com uses: the game ending
// beats a promotion, which beats a castle, which beats a check, and so on.
export function playForMove (move, { over = null, byOpponent = false } = {}) {
  if (over) { play('gameEnd'); return }
  if (!move) return
  if (move.mate) { play('gameEnd'); return }
  if (move.promotion) { play('promote'); return }
  if (move.castle) { play('castle'); return }
  if (move.check) { play('check'); return }
  if (move.captured) { play('capture'); return }
  play(byOpponent ? 'moveOpponent' : 'moveSelf')
}
