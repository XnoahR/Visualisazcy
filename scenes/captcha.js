// "I am not a robot" — what the checkbox is actually reading.
//
// The paths below are GENERATED, and every number the scene shows is measured
// off them: tortuosity, direction changes, speed variation. Nothing is typed in
// by hand. That matters, because the whole claim of the piece is that the
// difference between a person and a script is visible in the trace — so the
// figures had better come out of the trace.
//
// Deterministic: one seeded generator, same path every run, same numbers.

import { scene } from '../src/scene.js'

// mulberry32 — small, seeded, good enough for jitter.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const START = { x: 0.12, y: 0.82 }
const TARGET = { x: 0.74, y: 0.30 }

// A hand does not travel in a straight line. It arcs, it wobbles at the scale
// of a few pixels, it overshoots the target and comes back, and it slows down
// as it arrives. Each of those is a separate term below.
function humanPath(seed = 7) {
  const r = rng(seed)
  const pts = []
  const N = 84
  const ctrl = { x: 0.30, y: 0.34 }          // the arc's bend
  const overshoot = { x: 0.79, y: 0.245 }

  for (let i = 0; i <= N; i++) {
    const u = i / N
    // ease-in-out: slow to start, quick through the middle, slow to arrive
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
    const aim = e < 0.86 ? TARGET : overshoot
    const q = e < 0.86 ? e / 0.86 : (e - 0.86) / 0.14

    let x, y
    if (e < 0.86) {
      const m = 1 - q
      x = m * m * START.x + 2 * m * q * ctrl.x + q * q * aim.x
      y = m * m * START.y + 2 * m * q * ctrl.y + q * q * aim.y
    } else {
      // overshoot, then correct back onto the target
      const back = q * q
      x = overshoot.x + (TARGET.x - overshoot.x) * back
      y = overshoot.y + (TARGET.y - overshoot.y) * back
    }

    const jitter = 0.0075 * (1 - e * 0.6)     // steadier as it closes in
    pts.push({
      x: x + (r() - 0.5) * jitter,
      y: y + (r() - 0.5) * jitter,
      t: e * 1420 + r() * 14,                 // ms, uneven on purpose
    })
  }
  return pts
}

// A script has no hand. It sets the coordinate and clicks.
function botPath() {
  const pts = []
  const N = 84
  for (let i = 0; i <= N; i++) {
    const u = i / N
    pts.push({
      x: START.x + (TARGET.x - START.x) * u,
      y: START.y + (TARGET.y - START.y) * u,
      t: u * 120,                             // and it is fast
    })
  }
  return pts
}

// --- measurement -----------------------------------------------------------
// Everything the scene reports is computed here, from the points.

function measure(pts) {
  let length = 0
  const speeds = []
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    length += d
    const dt = Math.max(1, pts[i].t - pts[i - 1].t)
    speeds.push(d / dt)
  }
  const a = pts[0], b = pts[pts.length - 1]
  const straight = Math.hypot(b.x - a.x, b.y - a.y)

  // How often the direction changes by more than a couple of degrees.
  let turns = 0
  for (let i = 2; i < pts.length; i++) {
    const a1 = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x)
    const a2 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x)
    let d = Math.abs(a2 - a1)
    if (d > Math.PI) d = 2 * Math.PI - d
    if (d > 0.04) turns++
  }

  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length
  const varc = speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length
  const cv = Math.sqrt(varc) / mean            // speed variation, unitless

  return {
    tortuosity: length / straight,
    turns,
    speedVar: cv,
    duration: Math.round(pts[pts.length - 1].t),
  }
}

const human = humanPath()
const bot = botPath()
const hm = measure(human)
const bm = measure(bot)

// The score is a readable stand-in, not a real vendor's model: three signals,
// each normalised and capped, averaged. Labelled as such in the scene.
const score = (m) => Math.min(1, (
  Math.min(1, (m.tortuosity - 1) / 0.35) +
  Math.min(1, m.turns / 55) +
  Math.min(1, m.speedVar / 0.9)
) / 3)

export const captcha = scene({
  id: 'captcha',
  kind: 'trace',
  title: 'How "I am not a robot" works',
  caption: 'The checkbox is not the test. Getting to it is.',
  watermark: 'Visualisazcy',
  lanes: [
    { id: 'human', label: 'A person', points: human, metrics: hm, score: score(hm), tone: 'good' },
    { id: 'bot',   label: 'A script', points: bot,   metrics: bm, score: score(bm), tone: 'bad' },
  ],
  steps: [
    {
      label: 'One checkbox',
      note: 'A single box that asks you to confirm something a script could tick in a millisecond. So it cannot be the box that decides.',
      duration: 4200,
      lanes: ['human'],
      trace: 0,
    },
    {
      label: 'You reach for it',
      note: 'Watch the path, not the click. A hand arcs, wobbles, overshoots slightly, and slows down as it arrives.',
      duration: 5200,
      lanes: ['human'],
      trace: 'play',
    },
    {
      label: 'So does a script',
      note: 'It has no hand. It sets the coordinate and goes. Straight, even, and far too fast.',
      duration: 4800,
      lanes: ['human', 'bot'],
      trace: 'play',
    },
    {
      label: 'The path is the tell',
      note: 'Four numbers, every one of them measured off the traces above. None of them ask you anything.',
      duration: 5600,
      lanes: ['human', 'bot'],
      trace: 1,
      panels: ['metrics'],
    },
    {
      label: 'A score, not a test',
      note: 'The signals become one number. Nothing here is pass or fail yet — it is a degree of confidence.',
      duration: 5200,
      lanes: ['human', 'bot'],
      trace: 1,
      panels: ['metrics', 'score'],
    },
    {
      label: 'Only the doubtful get pictures',
      note: 'Score high enough and the box just ticks. The traffic lights you have clicked were never the test — they were the follow-up question.',
      duration: 6000,
      lanes: ['human', 'bot'],
      trace: 1,
      panels: ['metrics', 'score', 'verdict'],
    },
  ],
})

// A reel-length cut of the same material. Same generated paths, same measured
// numbers — only the pacing differs, because 31 seconds is a lesson and 9
// seconds is a post.
export const captchaShort = scene({
  id: 'captcha_short',
  kind: 'trace',
  title: 'Not a robot — 10 second cut',
  caption: 'One frame, ten seconds. Nothing re-composes; only the state moves.',
  watermark: 'Visualisazcy',
  lanes: captcha.lanes,
  steps: [
    {
      label: 'Two cursors, one checkbox',
      note: 'Both are heading for the same box. Watch how they get there.',
      duration: 3600,
      lanes: ['human', 'bot'],
      trace: 'play',
    },
    {
      label: 'The path is the tell',
      note: 'Measured off the traces. The script was already done in 120ms.',
      duration: 3400,
      lanes: ['human', 'bot'],
      trace: 1,
      panels: ['metrics'],
    },
    {
      label: 'Only the doubtful get pictures',
      note: 'Nothing here asked you a question.',
      duration: 3000,
      lanes: ['human', 'bot'],
      trace: 1,
      panels: ['metrics', 'verdict'],
    },
  ],
})
