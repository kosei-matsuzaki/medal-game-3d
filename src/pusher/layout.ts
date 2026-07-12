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
    homeZ: -1.0,
    amplitude: 0.8,
    speed: 1.4,
  },

  // Slot lane on the RAMP centre: TWO divider walls form a centre lane. When a
  // coin slides down BETWEEN them (through the sensor) the slot starts. Positions
  // are LOCAL to the deck (the lane moves with the pusher).
  slotLane: {
    xHalf: 0.36, // half-distance between the two divider walls (~single-file)
    wallHeight: 0.44,
    wallThickness: 0.06,
    zLocal: 0.35, // local z centre of the walls/sensor on the ramp
    zDepth: 1.0, // length along the ramp
    sensorY: 0.4, // local y centre of the trigger sensor
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
  medal: { radius: 0.3, height: 0.08, mass: 0.04 },
  maxMedals: 500,
  // Special ball (slot BALL match) that rolls the field. Field balls accumulate:
  // every BALLS_PER_DISC balls that leave the field triggers the disc challenge.
  ball: { radius: 0.32 },

  // Disc (円盤) JP challenge — a PHYSICAL turntable installed to the RIGHT of the
  // pusher cabinet, lying FLAT (parallel to the ground) on a pedestal. A real
  // dynamic ball rolls on the spinning disc and drops into one of 6 recessed
  // circular holes (real Rapier physics). One hole is JP-Chance; the others fill up
  // and persist across plays. The camera looks down at it (CameraRig.DISC).
  disc: {
    x: 4.6, // right of the right wall (halfWidth ≈ 2.7)
    y: 2.0, // deck height (top of the pedestal)
    z: 0.4,
    radius: 1.1, // playable disc radius (deck)
    rimHeight: 0.45, // containing wall around the rim
    holeRing: 0.64, // radius at which the 6 hole centres sit
    holeRadius: 0.14, // dimple opening radius — SMALLER than the ball. Each dent is a
    // spherical hollow with the SAME radius as the ball, so the ball's underside seats
    // flush into it (depth is derived, ≈ ballRadius − √(ballRadius²−holeRadius²)).
    ballRadius: 0.16, // the lottery ball
    domeHeight: 1.0, // transparent dome cover over the disc (keeps the ball from flying out)
    count: 6,
    jpIndex: 0, // which of the 6 holes is JP-Chance
  },
  ballsPerDisc: 4, // field balls that must drop before the disc challenge fires

  // JP CHALLENGE (ジャックポットチャレンジ) — reached only by landing in the disc's
  // JP-Chance hole. A big VERTICAL SOLID DISC (installed on the LEFT, facing the player,
  // rotating CONSTANTLY about Z) with `pocketCount` U-shaped notches CUT INTO ITS OUTER RIM
  // (円盤の外側をU字にくりぬいた形). Each notch is a prize pocket (100 / 200 / 300 メダル or
  // JPC). A ball starts at one END of a ~90° ARC RAIL sitting IN FRONT of the disc face and
  // swings like a PENDULUM along it, leaning on the face (the rig tilts back so gravity
  // presses it on). Friction + the timing of a passing notch slow it until it MESHES with a
  // notch (falls into the opening) — WHICH pocket it meshes with IS the result (入ったら
  // それで決まり, no "carried to the top" judgement). REAL physics, no scripted guidance; the
  // ball is sandwiched between a front glass and the disc face and drops in only where the
  // face opens (a notch).
  jp: {
    x: -5.6, // left of the cabinet, mirroring the disc. Far enough out that the disc rim
    // AND its glass cover (radius+0.1 = 2.6) clear the cabinet's left wall/glass (outer
    // edge x ≈ -2.8): glass edge lands at -3.0, a 0.2 gap — no visual overlap.
    y: 3.7, // disc centre height (raised so the bigger disc clears the ground)
    z: 0.4,
    radius: 2.5, // disc rim radius (where the U-notches are cut) — big enough that 16 U-slots
    // fit with healthy lands between them
    // Each notch is a U-SLOT (断面がU): straight parallel walls + a rounded semicircular
    // bottom (a "cylinder + hemisphere"). Its WIDTH ≈ the ball ⌀ so the ball fits snugly and
    // seats in the round bottom.
    notchWidth: 0.5, // tangential slot width (≈ ball ⌀ 0.4, a touch wider so the round ball drops in)
    notchDepth: 0.52, // radial depth from the rim to the deepest point of the round bottom
    pocketCount: 16, // number of U-notches around the rim
    thickness: 0.5, // disc thickness (visual + collider depth)
    ballRadius: 0.2, // the lottery ball
    spinSpeed: 0.45, // rad/s — the disc spins CONSTANTLY (no stop); the ball is caught by
    // friction + the timing of a passing notch. POSITIVE = counterclockwise as the player
    // sees it (direction per user request). |0.3| is too slow (few notch passes → long
    // plays); |0.45| keeps plays moving.
    railTilt: -0.3, // tilt of the whole rig (top leans back) so gravity presses the ball
    // (with railRamp=0 — the 90° tray, per user — the tilt ALONE must both return the ball
    // to the face and drop it into a passing notch. Verified at ramp 0: -0.25 → 0/3 resolve,
    // -0.28 → 1/3; -0.3 is the practical minimum. Do NOT make it more upright without
    // re-adding a ramp — which visibly breaks the 90° rail↔disc angle the user wants.)
    // BACK onto the disc face / into a notch when one opens (bigger = drops in more readily)
    // Arc rail: a HORIZONTAL TRAY (L-shape) that meets the disc FACE at 90°. It's a curved
    // floor following the bottom rim (so the ball rolls to bottom-centre) that juts straight
    // FORWARD (+Z, perpendicular to the face) as a shelf — NOT a band lying in the face plane.
    // Because it extends purely along +Z at a CONSTANT radius, the shelf floor is perpendicular
    // to the disc face (円盤とレールのなす角 = 90°); the rig's back-tilt (railTilt) then makes the
    // shelf slope gently back toward the face so a settled ball still drops into a passing notch.
    railRadius: 2.4, // radius the ball rides at (just inside the rim, on the face)
    railArc: 0.62, // half-angle of the front arc (rad) → full sweep ≈ 71° (narrower so the ball
    // reaches & SETTLES at the bottom quickly instead of skating over the wide shelf forever)
    railFrontZ: 0.46, // the ball's NOMINAL z (near the face, where it meshes)
    railDepth: 0.25, // how far FORWARD (+Z) the shelf juts out from the face (the tray depth).
    // Ends flush with the front glass (glassZ = railFrontZ + ballRadius + 0.06): the glass
    // sandwiches the ball close to the face, so a deeper tray is unreachable dead space.
    railRamp: 0.0, // MUST stay 0 (per user): the shelf keeps a CONSTANT radius → its floor is
    // perpendicular to the disc face (a true 90° L-shape; a ramp visibly breaks the 90°).
    // The back-slope that returns the ball to the face comes from the rig tilt alone, so
    // railTilt/railDepth must be tuned so a settled ball still reaches the face and meshes.
  },
} as const;
