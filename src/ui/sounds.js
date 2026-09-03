// Synthesised sound effects. Generating them with WebAudio keeps the repo free
// of audio assets and makes every sound instant, even on a cold PWA start.
let context = null
let enabled = true
let volume = 0.5

function ensureContext () {
  if (context) return context
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  context = new Ctor()
  return context
}

export function setSoundEnabled (value) { enabled = !!value }
export function setVolume (value) { volume = Math.max(0, Math.min(1, value)) }
export function unlockAudio () {
  const ctx = ensureContext()
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
}

function tone ({ frequency, duration = 0.08, type = 'sine', gain = 0.3, sweep = 0, delay = 0 }) {
  const ctx = ensureContext()
  if (!ctx || !enabled) return
  const start = ctx.currentTime + delay
  const oscillator = ctx.createOscillator()
  const amp = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  if (sweep) oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + sweep), start + duration)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * volume), start + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(amp).connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

function thud ({ duration = 0.09, gain = 0.35, delay = 0, cutoff = 900 }) {
  const ctx = ensureContext()
  if (!ctx || !enabled) return
  const start = ctx.currentTime + delay
  const frames = Math.floor(ctx.sampleRate * duration)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.4)
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(cutoff, start)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(gain * volume, start)
  source.connect(filter).connect(amp).connect(ctx.destination)
  source.start(start)
}

export const sounds = {
  move () { thud({ duration: 0.07, gain: 0.32, cutoff: 1200 }); tone({ frequency: 320, duration: 0.05, type: 'triangle', gain: 0.12 }) },
  capture () { thud({ duration: 0.12, gain: 0.45, cutoff: 700 }); tone({ frequency: 170, duration: 0.09, type: 'square', gain: 0.1, sweep: -60 }) },
  castle () { thud({ duration: 0.07, gain: 0.3, cutoff: 1100 }); thud({ duration: 0.07, gain: 0.28, cutoff: 1000, delay: 0.09 }) },
  check () { tone({ frequency: 880, duration: 0.1, type: 'triangle', gain: 0.22 }); tone({ frequency: 1180, duration: 0.12, type: 'triangle', gain: 0.18, delay: 0.07 }) },
  promote () { tone({ frequency: 620, duration: 0.1, type: 'triangle', gain: 0.2 }); tone({ frequency: 930, duration: 0.14, type: 'triangle', gain: 0.2, delay: 0.08 }) },
  illegal () { tone({ frequency: 150, duration: 0.11, type: 'sawtooth', gain: 0.16, sweep: -40 }) },
  select () { tone({ frequency: 520, duration: 0.03, type: 'sine', gain: 0.08 }) },
  win () { [523, 659, 784, 1046].forEach((frequency, i) => tone({ frequency, duration: 0.16, type: 'triangle', gain: 0.2, delay: i * 0.1 })) },
  lose () { [440, 370, 294, 220].forEach((frequency, i) => tone({ frequency, duration: 0.2, type: 'sine', gain: 0.18, delay: i * 0.12 })) },
  draw () { [440, 523, 440].forEach((frequency, i) => tone({ frequency, duration: 0.18, type: 'sine', gain: 0.16, delay: i * 0.12 })) },
  tick () { tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.06 }) },
  lowTime () { tone({ frequency: 980, duration: 0.06, type: 'square', gain: 0.14 }) }
}

export function playForMove (move, { over = null } = {}) {
  if (!move) return
  if (over === 'win') { sounds.win(); return }
  if (over === 'lose') { sounds.lose(); return }
  if (over === 'draw') { sounds.draw(); return }
  if (move.mate) { sounds.win(); return }
  if (move.castle) { sounds.castle(); return }
  if (move.promotion) { sounds.promote(); return }
  if (move.captured) { sounds.capture(); return }
  if (move.check) { sounds.check(); return }
  sounds.move()
}
