/**
 * Easing and interpolation functions ported from AntonBergaker/miniSweeper
 */

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function valueShift(current, target, step) {
  if (current < target) {
    return Math.min(current + step, target);
  } else if (current > target) {
    return Math.max(current - step, target);
  }
  return current;
}

/**
 * Quadratic ease out: start + (end - start) * t * (2 - t)
 */
export function easeQuadOut(start, end, t) {
  t = clamp(t, 0, 1);
  return start + (end - start) * (-t * (t - 2));
}

/**
 * Quadratic ease in-out
 */
export function easeQuadInOut(start, end, t) {
  t = clamp(t, 0, 1);
  t *= 2;
  const c = end - start;
  if (t < 1) return (c / 2) * t * t + start;
  t--;
  return (-c / 2) * (t * (t - 2) - 1) + start;
}

/**
 * Exponential ease in
 */
export function easeExpoIn(start, end, t) {
  t = clamp(t, 0, 1);
  if (t === 0) return start;
  return (end - start) * Math.pow(2, 10 * (t - 1)) + start;
}

/**
 * Back ease out (overshoots target slightly then settles)
 */
export function easeBackOut(start, end, t, overshoot = 3.5) {
  t = clamp(t, 0, 1);
  t = t - 1;
  return (end - start) * (t * t * ((overshoot + 1) * t + overshoot) + 1) + start;
}

/**
 * Back ease in-out
 */
export function easeBackInOut(start, end, t, overshoot = 1.70158) {
  t = clamp(t, 0, 1);
  let s = overshoot * 1.525;
  t *= 2;
  const c = end - start;
  if (t < 1) {
    return (c / 2) * (t * t * ((s + 1) * t - s)) + start;
  }
  t -= 2;
  return (c / 2) * (t * t * ((s + 1) * t + s) + 2) + start;
}

/**
 * Peaks at `peakTime` with value `peakVal`, then returns to `start` at `duration`
 */
export function easeQuadOutPeek(start, peakVal, t, peakTime = 0.5, duration = 1.0) {
  t = clamp(t, 0, duration);
  if (t < peakTime) {
    return easeQuadOut(start, peakVal, t / peakTime);
  } else {
    const rem = duration - peakTime;
    if (rem <= 0) return start;
    const u = (t - peakTime) / rem;
    return peakVal + (start - peakVal) * (u * u);
  }
}
