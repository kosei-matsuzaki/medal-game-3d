/**
 * Single source of truth for cabinet dimensions, shared by the visual meshes,
 * the static colliders, the moving pusher, the spawner and detectors.
 * Units are metres. Coordinate convention: +Z = toward the player (front),
 * -Z = back; +Y = up.
 */
export const LAYOUT = {
  halfWidth: 2.7, // outer wall half-width (x)
  wallHeight: 2.2,
  wallThickness: 0.2,
  backWallZ: -2.6, // the fixed back wall; the pusher emerges from beneath it

  // The fixed ground (一段目 / lower table). FLAT, full width, no holes. Coins are
  // pushed forward and fall off the FRONT edge (手前) into the payout.
  table: {
    y: 0,
    thickness: 0.2,
    backZ: -4.4, // extends back under the full pusher travel (hidden behind back wall)
    frontZ: 3.4, // OPEN front edge — coins fall off here (longer lower field)
  },

  // The lower field is a TRAPEZOID seen from above: full width at the back, then
  // tapering in toward the player. The taper only begins in FRONT of the pusher's
  // furthest reach (ramp base tops out at z=0.6) — the deck is a fixed-width slab,
  // so narrowing the walls anywhere it travels would either jam it or open a slot
  // down each side. The taper does real work: it squeezes the coin bank toward
  // the side walls, which is where the drains are.
  taper: {
    startZ: 0.7, // full width behind this, narrowing in front of it
    frontHalfWidth: 2.05, // half-width at the open front edge (from 2.7)
  },

  // Side drain holes (横穴) — openings cut into the TAPERED SIDE WALLS, not the
  // floor. Height is the whole trick: a medal lying flat is 0.08 thick and slips
  // straight out, while the mini ball is a 0.52∅ sphere and physically cannot fit
  // through a 0.22 gap. That single number replaces what used to need an
  // invisible ball-only guide rail, and it is honest — you can see why the ball
  // stays in.
  sideHole: {
    z0: 1.0, // opening runs from here…
    z1: 3.1, // …to here. Deliberately shorter than the full wall: running it
    // corner-to-corner drained well but read as "the side of the cabinet is
    // missing" rather than as a pair of drain slots.
    // Height is the whole trick: a medal lying flat is 0.08 thick and slips
    // straight out, while the mini ball is a 0.52∅ sphere and physically cannot
    // fit. That single number replaces what used to need an invisible ball-only
    // guide rail, and it is honest — you can see why the ball stays in.
    //
    // It has to be THIS generous because the taper works against the drain: a
    // narrowing channel presses coins INWARD, away from the walls, so the wall
    // openings get far less traffic than floor holes did. Measured at 0.22 high
    // the field drained only 11% (vs 52% for floor holes), which left no house
    // edge at all and sent payback past 200%.
    // Taller than it needs to be for a coin, because the floor is FLAT: the taper
    // presses coins inward, away from the walls, so the opening has to be a big
    // target to shed enough of them. Capped by the ball — at ⌀0.76 against a 0.58
    // gap the ball is comfortably excluded while a coin (0.08 thick) walks out.
    // Held BELOW the mini cube's 0.52 edge so the cube can never wash out. The
    // drain rate is what caps how much the board is allowed to pay, so every
    // millimetre the cube grows is a millimetre this can grow with it.
    // 0.46, held 0.06 clear of the mini cube's 0.52 edge so the cube still cannot
    // wash out. Raised (and the opening lengthened, z0 1.35 -> 1.0) because the
    // medal was made larger and thicker for the new struck-metal look, and a
    // fatter coin rides the taper further from the wall: measured drain fell to
    // 24%, at which point the machine returned ~110% and the house LOST money.
    height: 0.46,
  },

  // Front collection tray (受け皿): coins that slide off the OPEN front edge fall
  // DOWN into this wide, low bin in front of the cabinet, briefly pile up where the
  // player can watch them land, then are collected (credited + cleared). Lower and
  // wider than the field so the fall + collection is clearly visible.
  frontPayout: {
    z: 4.6, // bin centre, in front of the cabinet
    halfDepth: 1.15, // front-to-back half-size (wider catch area)
    floorY: -1.1, // bin floor — well below the front edge (y≈0) for a visible drop
    wallH: 0.6, // bin wall height above the floor
    sensorY: -0.35, // payout sensor plane near the top of the bin opening
    collectDelay: 1.2, // seconds a credited coin rests in the bin before being cleared
  },

  // Pusher (二段目 / upper deck). A deep, full-width TRAPEZOID deck that slides out
  // from beneath the back wall. Its front is a 45° ramp connecting the upper deck
  // (二段目) down to the flat lower ground (一段目). Coins dropped onto the deck
  // slide down the ramp; centre coins are caught by the slot-stock lip on the ramp.
  //   ramp base (front-bottom) travels: homeZ ± amplitude + frontBottom = -1.0 .. 0.6
  //   back-bottom (max fwd):            homeZ + amplitude - backDepth   = -2.6 (=backWallZ)
  pusher: {
    topY: 0.85, // deck top height = the two-tier step
    halfWidth: 2.68, // nearly flush with the side walls (2.7) — no visible side slit
    backDepth: 2.4,
    frontBottom: 0.8,
    slopeAngleDeg: 45, // ramp incline from horizontal
    // The front is a TRAPEZOID in side profile, not a wedge: a vertical face of
    // this height at the bottom, then the ramp above it. A ramp that runs all the
    // way down to the table meets the lower deck at a feather edge and simply
    // rides up over the coins lying there instead of pushing them.
    faceHeight: 0.3,
    // Stroke: pulled forward and shortened so the deck no longer disappears under
    // the back wall on the return. Max-forward reach is unchanged (front face at
    // z=0.6, still clear of the taper at 0.7) and the back-bottom still lands on
    // backWallZ at max forward, so no gap opens behind it.
    homeZ: -0.75,
    amplitude: 0.55,
    speed: 1.4,
  },

  // Spawn chute: coins are inserted at the very BACK of the upper deck (二段目),
  // near the back wall. They pile and the pusher feeds them forward; centre coins
  // slide down the slot lane (→ slot), the rest go to the front payout.
  chute: { y: 1.7, z: -2.3 },

  // Back-top monitor where minigames (slot / roulette / JP) are displayed. Tilted
  // to face the fixed camera. Its bottom bezel SEATS on the back-wall top (no gap).
  // All minigame/UI content is drawn FLAT, directly on the screen surface.
  monitor: {
    x: 0,
    y: 3.75, // bottom edge lands on the back-wall top (y≈2.4)
    z: -2.95, // just behind the back wall (z=-2.6), bezel touching it
    rotX: -0.22, // tilt top toward the player
    width: 4.9,
    height: 2.7,
    // distance from the monitor origin to the CONTENT plane, along the screen
    // normal. The glossy screen mesh sits at +0.06; content hugs it at +0.08 so
    // everything reads as pixels ON the display, not objects floating in front.
    contentOffset: 0.08,
  },

  // Common visual ground level: the bottom of the payout bin. The cabinet plinth
  // and the disc / JP pedestals all extend down to this plane so every unit sits
  // on the same floor (nothing floats at its own height).
  groundY: -1.15,

  killY: -3.5,
  // A real pusher token is a chunky thing you can feel the edge of. The old
  // 0.30 x 0.08 disc was proportioned like a washer; this is a little wider and
  // noticeably thicker, which is what carries the milled edge on screen.
  // NOTE: both figures feed the drain rate — a wider coin packs differently
  // against the side openings — so changing them means re-running draintest.
  medal: { radius: 0.32, height: 0.105, mass: 0.04 },
  maxMedals: 500,
  // Mini ball (ミニボール) — the すごろく trigger, and the ONLY way the board
  // advances. One is dispensed from the hopper every `medalsPerBall` medals the
  // player inserts; it is then shoved across the field like a coin. Drop it off
  // the FRONT edge and it spins the board once. Send it down a side hole and it
  // is simply lost — same rule as a medal.
  // The playing piece is a small ROUNDED die — the same object the board is
  // driven by, so the machine has one vocabulary. Heavily filleted so it rolls
  // instead of sitting where it lands.
  //
  // Its edge is what sets `sideHole.height`, not the other way round: a rounded
  // cuboid's minimum width in any orientation is still its edge, so the drain
  // opening has to stay clear of it or the board's only fuel washes away.
  miniBall: { size: 0.52, round: 0.19 },
  /** Medals the player must insert to earn one mini ball (≈ one board spin). */
  // Raised deliberately. The payback ratio fixes medals-dispensed-per-medal-in,
  // so the ONLY way to make an individual win feel like a win is to make wins
  // rarer. At 20 the board had ~5 medals to hand out per turn, which reads as
  // nothing; at 25 it has ~6.3 and the bowl can pay in double digits.
  // Medals inserted per dice cube dispensed — i.e. what one board turn COSTS.
  //
  // THE payback lever. Everything else fights over scraps: with a measured drain
  // of 29.3% the front tray hands back 71% of every medal inserted no matter what
  // the board does. This changes the denominator instead, so it moves payback
  // directly — and because a turn still pays what it always paid, raising it makes
  // wins rarer AND bigger, which is the only way to make one feel like an event
  // when the long-run ratio is fixed.
  //
  // 40 with PAYOUT_SCALE 0.65 models at 90.2%. See README「メダル収支」.
  medalsPerBall: 40,

  // DICE TRAY & JACKPOT BOWL — both BOLTED TO THE TAPER WALLS.
  //
  // They used to stand on their own pedestals well outboard of the cabinet, at
  // x=±4.3. Two problems with that: from the play camera they sat far back and
  // off to the sides where they were hard to see, and a lit column holding a bowl
  // in mid-air reads as set dressing rather than as part of the machine.
  //
  // Now each one hangs on the OUTER face of the angled wall of the trapezoid — the
  // same wall the drain slots are cut into — so they belong to the cabinet, and
  // they sit forward (z≈2.2) where the player is already looking. Both are ~62%
  // of their old size to fit there. Scaling a gravity-driven simulation does
  // change it (gravity does not scale with the model), so the launch speeds are
  // scaled by √0.62 as well, which is the dimensionally correct factor and keeps
  // the throw and the orbit looking exactly as they did at full size.
  //
  // WALL_YAW is the taper's own angle. The units are rotated to match it so they
  // sit flush instead of leaving a wedge of daylight against the wall.

  // DICE TRAY (ダイストレイ) — on the LEFT taper wall, mirroring the bowl.
  //
  // The board is moved by a REAL die: it is thrown into this tray, tumbles, and
  // whichever face ends up pointing at the ceiling is the number. Nothing is
  // drawn in advance and animated toward — same principle as the bowl, and the
  // reason the two units bracket the cabinet.
  dice: {
    // NB: no `x`. Which x puts this flush against the taper is a consequence of
    // the taper's own geometry, so wallMount() derives it; authoring it here as
    // well would give the same fact two homes and let them drift apart.
    y: 1.35, // tray floor. Below the wall top (2.4) so the unit reads as fitted
    // into the side of the cabinet rather than perched on top of it.
    z: 2.22,
    half: 0.61, // inner half-width of the tray floor. Snug on purpose — in a big
    // tray the dice are specks and the throw reads as nothing happening — but it
    // has to hold THREE of them for チンチロ without them shouldering each other
    // over the wall.
    wall: 0.42, // containing wall height. It has to CLEAR the die (0.385), or the
    // die sits proud of the rim and the whole thing reads as a coaster with a
    // block on it rather than as a tray with dice in it. Taller than one die
    // strictly needs, too, because three tumbling together bounce off each other
    // and not just off the floor.
    size: 0.385, // die edge length
    round: 0.124, // corner fillet, matching the playing cube
    throwSpeed: 1.6, // gentle: the dice are dropped in and tumble, not fired
    // A throw MUST resolve: past this the die is nudged, and past twice this it
    // is snapped flat to its nearest face. A board that can hang on a cocked die
    // is worse than one that occasionally straightens it.
    patience: 2.0,
  },

  // JACKPOT BOWL (抽選ボウル) — on the RIGHT taper wall.
  //
  // A funnel: a ball is fired around the rim and spirals inward, orbiting for a
  // long time before it finally plunges through the hole at the centre. While it
  // circles, a roulette spins on the monitor; the segment under the pointer AT
  // THE MOMENT the ball drops through is the prize.
  //
  // Nothing is scripted — the physics decides only WHEN the ball falls, and the
  // when decides the what. That is the whole trick: the suspense is real because
  // even the machine does not know the answer until the ball is gone.
  bowl: {
    // no `x` — see the note on the dice tray; wallMount() derives it
    y: 1.35, // hole-plane height, matching the tray so the two read as a pair
    z: 2.26,
    rimRadius: 0.78, // outer lip the ball is launched against
    holeRadius: 0.15, // centre opening — wider than the ball, so it always fits
    depth: 0.56, // rim height above the hole plane
    // Vortex profile exponent. Below 1 the surface is shallow out at the rim and
    // plunges near the hole, so the ball laps the bowl for ages and then drops
    // fast — a funnel, not a salad bowl.
    profileExp: 0.55,
    ballRadius: 0.1,
    launchSpeed: 2.7, // tangential speed at the rim
    // A play must always resolve: past this, the ball is nudged toward the centre
    // a little harder every second until it goes in.
    patience: 9.0,
    segments: 16, // roulette wedges (exactly one is the JACKPOT)
  },
} as const;

/**
 * Where the tapered side wall is, and which way it faces, at a given z.
 *
 * The dice tray and the jackpot bowl hang off the OUTSIDE of that wall, so both
 * need the same two numbers: the point on its outer face, and its yaw. Deriving
 * them here means the two units stay glued to the cabinet if the taper is ever
 * re-cut — the alternative is two hand-copied magic numbers that silently come
 * unstuck.
 *
 * `side` is -1 for the left wall, +1 for the right.
 */
export function wallMount(side: -1 | 1, z: number): { x: number; yaw: number } {
  const t = LAYOUT.taper;
  const run = LAYOUT.table.frontZ - t.startZ;
  const drop = LAYOUT.halfWidth - t.frontHalfWidth;
  // half-width of the FIELD at this z (constant behind the taper start)
  const k = Math.max(0, Math.min(1, (z - t.startZ) / run));
  const inner = LAYOUT.halfWidth - drop * k;
  const yaw = Math.atan2(drop, run);
  // outer face is one wall thickness out along the wall's normal
  const outer = inner + LAYOUT.wallThickness / Math.cos(yaw);
  return { x: side * outer, yaw: -side * yaw };
}
