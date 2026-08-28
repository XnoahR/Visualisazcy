// Easing. The difference between "it moves" and "it feels made on purpose".

export const linear        = t => t
export const easeOutCubic  = t => 1 - Math.pow(1 - t, 3)
export const easeOutQuint  = t => 1 - Math.pow(1 - t, 5)
export const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2
export const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
export const easeOutExpo   = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)

// Slight overshoot on the way in. Used for card entrances.
export function easeOutBack(t, s = 1.34) {
  const u = t - 1
  return 1 + (s + 1) * u * u * u + s * u * u
}

// Frame-rate independent exponential smoothing. This is the workhorse: it pulls
// a displayed value toward a target at a fixed half-life regardless of dt, so a
// meter fed by a noisy measurement stops jittering without ever lagging visibly.
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt / 1000)
}

export const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t
export const mix = (a, b, t) => a + (b - a) * t

// Progress of a delayed, eased entrance.
export function stagger(now, startAt, duration) {
  return clamp01((now - startAt) / duration)
}
