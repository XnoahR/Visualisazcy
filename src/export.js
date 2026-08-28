// Video export.
//
// The trick is captureStream(0) — a manual-frame track. Nothing is captured
// until requestFrame() is called, so the engine is stepped by a FIXED dt per
// frame rather than by the wall clock. A slow machine then produces the same
// video as a fast one; it just takes longer to write it.
//
// The calls are still paced in real time, because MediaRecorder timestamps by
// wall clock and would otherwise compress 300 frames into a fraction of a
// second. So export takes about as long as the clip, but the CONTENT is
// frame-exact either way, which is the part that matters.

const MIME = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function supported() {
  return typeof MediaRecorder !== 'undefined' &&
         typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
         MIME.some(m => MediaRecorder.isTypeSupported(m))
}

const pickMime = () => MIME.find(m => MediaRecorder.isTypeSupported(m))

// Total logical length of whatever is loaded, in ms.
export function clipLength(engine, fallback = 9000) {
  const tl = engine.timeline
  if (!tl) return fallback
  return tl.steps.reduce((n, s) => n + s.duration, 0)
}

export async function record(engine, canvas, opts = {}) {
  if (!supported()) throw new Error('this browser cannot record a canvas')

  const fps = opts.fps || 30
  const duration = opts.duration || clipLength(engine)
  const dt = 1000 / fps
  const frames = Math.max(1, Math.round(duration / dt))
  const onProgress = opts.onProgress || (() => {})

  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0]
  const rec = new MediaRecorder(stream, {
    mimeType: pickMime(),
    videoBitsPerSecond: opts.bitrate || 8_000_000,
  })

  const chunks = []
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise(res => { rec.onstop = res })

  // Start from the top of the story, running, with the loop under our control.
  engine.beginExport()
  rec.start()

  try {
    for (let i = 0; i < frames; i++) {
      engine.stepFrame(dt)
      track.requestFrame()
      onProgress(i + 1, frames)
      await paced(dt)
    }
  } finally {
    rec.stop()
    engine.endExport()
  }

  await done
  track.stop()
  return new Blob(chunks, { type: pickMime() })
}

// Wait about dt, without drifting badly on a busy frame.
function paced(dt) {
  return new Promise(res => setTimeout(res, Math.max(0, dt - 1)))
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
