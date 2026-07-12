/** Collider tags & collision groups for the physics world. */

export enum BodyTag {
  Static = 'static',
  Pusher = 'pusher',
  Medal = 'medal',
  Ball = 'ball', // special ball that leads to the JP challenge
  Payout = 'payout', // sensor: front payout slot
  FallHole = 'fall', // sensor: side loss holes
  Chucker = 'chucker', // sensor: slot lane (coin) / JP trigger (ball)
}

export interface ColliderInfo {
  tag: BodyTag;
  /** chucker id, target id, etc. */
  id?: number;
  /** back-reference into a pool (medal slot index) */
  slot?: number;
}

/**
 * Rapier collision groups: high 16 bits = membership, low 16 bits = filter.
 * Keep medals colliding with the cabinet and each other, and let sensors detect
 * medals without blocking them.
 */
export const GROUP = {
  STATIC: 0b0001,
  MEDAL: 0b0010,
  SENSOR: 0b0100,
  BALL: 0b100000,
  DISC: 0b1000000, // the JP disc lottery system (isolated from the main field)
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}
