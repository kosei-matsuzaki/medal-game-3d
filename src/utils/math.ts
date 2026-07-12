export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate-independent exponential approach (used for camera damping). */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const TAU = Math.PI * 2;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Stronger deceleration than cubic — long slow tail, used for the slot reach. */
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
