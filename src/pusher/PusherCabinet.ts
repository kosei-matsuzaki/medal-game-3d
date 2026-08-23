import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyTag, GROUP, groups } from '../physics/types';
import { createCabinetMaterials, CabinetMaterials } from '../render/materials/CabinetMaterials';
import { LAYOUT } from './layout';

/**
 * Builds the static cabinet: lower table (with chucker holes), side/back walls,
 * sensors (payout, chuckers), and decorative frame/glass. Owns nothing dynamic.
 */
export class PusherCabinet {
  readonly group = new THREE.Group();
  readonly mats: CabinetMaterials;
  private body: RAPIER.RigidBody;

  constructor(private physics: PhysicsWorld, private scene: THREE.Scene) {
    this.mats = createCabinetMaterials();
    this.group.name = 'cabinet';
    scene.add(this.group);

    const desc = physics.RAPIER.RigidBodyDesc.fixed();
    this.body = physics.world.createRigidBody(desc);

    this.buildTable();
    this.buildWalls();
    this.buildFrontPayout();
    this.buildFrame();
    this.buildRearHousing();
    this.buildCaseFrame();
    this.buildNeon();
    this.buildBackDisplay();
    this.buildCover();
  }

  /** Add a static solid box: visual mesh + cuboid collider. */
  private solidBox(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    mat: THREE.Material
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const cd = this.physics.RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setFriction(0.4)
      .setRestitution(0.02)
      .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
    const collider = this.physics.world.createCollider(cd, this.body);
    this.physics.registerCollider(collider, { tag: BodyTag.Static });
    return mesh;
  }

  private buildTable(): void {
    const { table, halfWidth, taper } = LAYOUT;
    const ty = table.y - table.thickness / 2;
    const hyT = table.thickness / 2;
    // Rectangular under the pusher, trapezoid in front of it.
    this.tableSegment(-halfWidth, halfWidth, table.backZ, taper.startZ, ty, hyT);
    this.buildTaperedTable(ty, hyT);
  }

  /** The narrowing front half of the floor. A trapezoid prism is convex, so one
   *  convex-hull collider covers it exactly — no trimesh, no seams. */
  private buildTaperedTable(cy: number, hy: number): void {
    const { halfWidth, taper, table } = LAYOUT;
    const z0 = taper.startZ;
    const z1 = table.frontZ;
    const w0 = halfWidth;
    const w1 = taper.frontHalfWidth;
    const pts = [
      new THREE.Vector3(-w0, cy - hy, z0), new THREE.Vector3(w0, cy - hy, z0),
      new THREE.Vector3(-w1, cy - hy, z1), new THREE.Vector3(w1, cy - hy, z1),
      new THREE.Vector3(-w0, cy + hy, z0), new THREE.Vector3(w0, cy + hy, z0),
      new THREE.Vector3(-w1, cy + hy, z1), new THREE.Vector3(w1, cy + hy, z1),
    ];
    const geo = new ConvexGeometry(pts);
    geo.computeVertexNormals();
    // ConvexGeometry ships NO uv attribute, and `mats.field` is driven by a tiled
    // map + emissiveMap — without uvs the whole trapezoid samples nothing and
    // renders as a black hole in the middle of the playfield. Project planar uvs
    // from above at the same tiling as the rectangular half so the two read as
    // one continuous floor.
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + halfWidth) / (halfWidth * 2);
      uv[i * 2 + 1] = (pos.getZ(i) - z0) / (z1 - z0);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    const mesh = new THREE.Mesh(geo, this.mats.field);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const flat = new Float32Array(pts.length * 3);
    pts.forEach((v, i) => { flat[i * 3] = v.x; flat[i * 3 + 1] = v.y; flat[i * 3 + 2] = v.z; });
    const hull = this.physics.RAPIER.ColliderDesc.convexHull(flat);
    if (!hull) return;
    hull.setFriction(0.4).setRestitution(0.02)
      .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
    const col = this.physics.world.createCollider(hull, this.body);
    this.physics.registerCollider(col, { tag: BodyTag.Static });
  }

  /** A static box with an arbitrary rotation (mesh + matching rotated collider). */
  private rotatedBox(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    euler: THREE.Euler, mat: THREE.Material, visible = true
  ): void {
    if (visible) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
      mesh.position.set(cx, cy, cz);
      mesh.setRotationFromEuler(euler);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const q = new THREE.Quaternion().setFromEuler(euler);
    const cd = this.physics.RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.3)
      .setRestitution(0.04)
      .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
    const col = this.physics.world.createCollider(cd, this.body);
    this.physics.registerCollider(col, { tag: BodyTag.Static });
  }

  /**
   * The angled side walls of the trapezoid, each carrying a DRAIN OPENING.
   *
   * The wall is split along z into: solid, then a stretch that exists only ABOVE
   * `sideHole.height` (the gap medals escape through), then solid again. Coins
   * squeezed outward by the taper slide under the lip and out of play; the mini
   * ball is too fat to follow them.
   */
  private buildTaperedWalls(): void {
    const { halfWidth, wallHeight, wallThickness, table, taper, sideHole: sh } = LAYOUT;
    const z0 = taper.startZ;
    const z1 = table.frontZ;
    const wallTop = wallHeight + 0.2;
    const t = wallThickness / 2;

    // half-width of the field at a given z, following the taper
    const wAt = (z: number) =>
      halfWidth + ((taper.frontHalfWidth - halfWidth) * (z - z0)) / (z1 - z0);
    // NOTE THE SIGN. The wall runs from (halfWidth, z0) to (frontHalfWidth, z1),
    // so on the RIGHT side x DECREASES as z grows — the yaw that carries a box
    // along it is NEGATIVE there, and positive on the left. Using +sx*yaw mirrors
    // both walls and the field visibly FLARES toward the player instead of
    // narrowing, which is the opposite of the whole point.
    const yaw = Math.atan2(halfWidth - taper.frontHalfWidth, z1 - z0);

    // a wall run between two z values, spanning [yLo, yHi]
    const run = (za: number, zb: number, yLo: number, yHi: number, sx: number) => {
      if (zb - za < 1e-4 || yHi - yLo < 1e-4) return;
      const zc = (za + zb) / 2;
      // centre the slab on the taper line, pushed outward by half its thickness
      const xc = sx * (wAt(zc) + t * Math.cos(yaw));
      const len = Math.hypot(wAt(za) - wAt(zb), zb - za) / 2;
      this.rotatedBox(
        xc, (yLo + yHi) / 2, zc,
        t, (yHi - yLo) / 2, len,
        new THREE.Euler(0, -sx * yaw, 0), this.mats.frame
      );
    };

    for (const sx of [-1, 1]) {
      run(z0, sh.z0, -0.2, wallTop, sx); // solid, back of the opening
      run(sh.z0, sh.z1, sh.height, wallTop, sx); // ONLY above the gap
      run(sh.z1, z1, -0.2, wallTop, sx); // solid, front of the opening
      this.buildDrain(sx, yaw, wAt);
    }
  }

  /** Outside each opening: a dark channel and the sensor that swallows whatever
   *  slides out. Placed strictly OUTBOARD of the wall line so it can never reach
   *  into the field and eat a coin that is still in play. */
  private buildDrain(sx: number, yaw: number, wAt: (z: number) => number): void {
    const { sideHole: sh } = LAYOUT;
    const R = this.physics.RAPIER;
    const zc = (sh.z0 + sh.z1) / 2;
    const len = Math.hypot(wAt(sh.z0) - wAt(sh.z1), sh.z1 - sh.z0) / 2;
    // Sensor only — no chute mesh. With the body tapered there is no shelf left
    // to recess a channel into, and a box out here would float beside the cabinet.
    // The lit gap in the wall is the thing the player reads.
    const OUT = 0.26;
    const xc = sx * (wAt(zc) + LAYOUT.wallThickness + OUT);

    // neon lip along the opening so the danger line is visible from the front
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, len * 2),
      this.mats.neonPink
    );
    lip.position.set(sx * (wAt(zc) - 0.03), sh.height, zc);
    lip.setRotationFromEuler(new THREE.Euler(0, -sx * yaw, 0));
    this.group.add(lip);

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -sx * yaw, 0));
    // Down at floor level, NOT at the opening. Catching the coin the instant it
    // clears the wall makes it blink out of existence half a metre in the air —
    // the player never sees it leave. Sitting it near the ground lets the coin
    // fall the full height of the cabinet side first, so the loss actually reads.
    const cd = R.ColliderDesc.cuboid(OUT, 0.25, len)
      .setTranslation(xc, LAYOUT.groundY + 0.2, zc)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setSensor(true)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP.SENSOR, GROUP.MEDAL | GROUP.BALL));
    const col = this.physics.world.createCollider(cd, this.body);
    this.physics.registerCollider(col, { tag: BodyTag.FallHole });
  }

  private tableSegment(x0: number, x1: number, z0: number, z1: number, cy: number, hy: number): void {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.solidBox(cx, cy, cz, (x1 - x0) / 2, hy, (z1 - z0) / 2, this.mats.field);
  }

  private buildWalls(): void {
    const { halfWidth, wallHeight, wallThickness, table, pusher, backWallZ } = LAYOUT;
    const visBack = backWallZ; // visible field starts at the back wall
    const depth = table.frontZ - visBack;
    const cz = (table.frontZ + visBack) / 2;
    // side walls rise to the SAME height as the back wall so the opaque rim is a
    // single level line all around (no stepped corner at the back)
    const wallTop = wallHeight + 0.2;
    const wallBottom = -0.2; // sits exactly on the plinth top (no coplanar overlap)
    const hy = (wallTop - wallBottom) / 2;
    const cy = (wallTop + wallBottom) / 2;
    // Straight side walls only as far as the taper start; the narrowing front
    // section builds its own angled walls (and their drain openings).
    const straightBack = visBack;
    const straightFront = LAYOUT.taper.startZ;
    for (const sx of [-1, 1]) {
      this.solidBox(
        sx * (halfWidth + wallThickness / 2),
        cy,
        (straightBack + straightFront) / 2,
        wallThickness / 2,
        hy,
        (straightFront - straightBack) / 2,
        this.mats.frame
      );
    }
    this.buildTaperedWalls();
    // back wall — raised ABOVE the pusher deck so the pusher slides out beneath it
    const bwBottom = pusher.topY;
    const bwTop = wallTop;
    this.solidBox(
      0,
      (bwBottom + bwTop) / 2,
      backWallZ - wallThickness / 2,
      halfWidth + wallThickness,
      (bwTop - bwBottom) / 2,
      wallThickness / 2,
      this.mats.frame
    );
    // front is OPEN — coins fall off the front edge into the payout.
  }

  /** Front collection tray: a wide, LOW physical bin in front of the open front
   *  edge. Coins slide off the edge, fall ~1m, land and briefly pile in the bin
   *  (where the player can watch the collection), then are credited + cleared. */
  private buildFrontPayout(): void {
    const { frontPayout: fp, halfWidth, table } = LAYOUT;
    const binBackZ = fp.z - fp.halfDepth; // ~3.45, just past the front edge
    const binFrontZ = fp.z + fp.halfDepth;
    const wallHalfH = fp.wallH / 2;
    const t = 0.08; // wall thickness (half)

    // payout sensor: a plane near the TOP of the bin opening. A coin/ball falling
    // in crosses it once (on entry) → credited; the coin then settles in the bin
    // and is cleared after a short delay (see DropDetector / MedalPool).
    const cd = this.physics.RAPIER.ColliderDesc.cuboid(LAYOUT.taper.frontHalfWidth, 0.25, fp.halfDepth)
      .setTranslation(0, fp.sensorY, fp.z)
      .setSensor(true)
      .setActiveEvents(this.physics.RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP.SENSOR, GROUP.MEDAL | GROUP.BALL));
    const col = this.physics.world.createCollider(cd, this.body);
    this.physics.registerCollider(col, { tag: BodyTag.Payout });

    // --- physical bin: solid floor + four containing walls ---
    // The bin's OUTER faces line up with the cabinet wall faces (±(halfWidth +
    // wallThickness)) so the tray reads as part of the same body, not a
    // narrower attachment; its inner faces match the field width.
    // matches the TAPERED mouth above it, not the rear width — a tray wider than
    // the opening it catches from reads as a separate slab bolted on the front
    const binHalfW = LAYOUT.taper.frontHalfWidth + LAYOUT.wallThickness;
    const binDepth = binFrontZ - binBackZ;
    // floor
    this.solidBox(0, fp.floorY, fp.z, binHalfW, 0.05, fp.halfDepth, this.mats.frame);
    // back wall (toward the cabinet) — low so incoming coins arc over it but it
    // stops them rolling back under the body
    this.solidBox(0, fp.floorY + 0.18, binBackZ, binHalfW, 0.18, t, this.mats.frame);
    // front lip — taller, keeps coins from bouncing out toward the player
    this.solidBox(0, fp.floorY + wallHalfH, binFrontZ, binHalfW, wallHalfH, t, this.mats.frame);
    // side walls — same thickness/position as the cabinet side walls above them
    for (const sx of [-1, 1]) {
      this.solidBox(
        sx * (LAYOUT.taper.frontHalfWidth + LAYOUT.wallThickness / 2),
        fp.floorY + wallHalfH,
        fp.z,
        LAYOUT.wallThickness / 2,
        wallHalfH,
        fp.halfDepth,
        this.mats.frame
      );
    }
    // Inner glow along the bin floor. Its OWN low-emissive material, not the
    // shared neon: this panel is nearly the whole tray floor, and at neon
    // strength it clipped to a flat white slab under bloom — the brightest
    // thing on screen, sitting in the least important corner of it.
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(LAYOUT.taper.frontHalfWidth * 2 - 0.24, 0.02, binDepth - 0.2),
      new THREE.MeshStandardMaterial({
        // dark base: a light blue diffuse this size still washes to white once
        // the key + IBL land on it, however low the emissive is set
        color: 0x081026,
        emissive: 0x1246a8,
        emissiveIntensity: 0.35,
        metalness: 0.1,
        roughness: 0.5,
      })
    );
    glow.position.set(0, fp.floorY + 0.06, fp.z);
    this.group.add(glow);

    // glowing lip marking the payout edge (the open front of the field)
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(LAYOUT.taper.frontHalfWidth * 2, 0.05, 0.05),
      this.mats.neonBlue
    );
    lip.position.set(0, table.y + 0.02, table.frontZ);
    this.group.add(lip);
  }

  private buildFrame(): void {
    const { halfWidth, wallThickness, table, backWallZ, frontPayout: fp, groundY } = LAYOUT;
    const backZ = backWallZ;
    // base plinth under everything — its FRONT face is pulled back to the rear of
    // the front collection bin so it doesn't fill the (now lower) tray. It spans
    // seamlessly from the table underside down to the common ground plane.
    const plinthFront = fp.z - fp.halfDepth;
    const plinthBack = table.backZ - 0.1; // wraps beneath the table's rear extent
    const plinthTop = table.y - table.thickness; // flush with the table underside
    // The body FOLLOWS THE TAPER at the front. A rectangular plinth under a
    // trapezoid playfield leaves a bright shelf of cabinet top sticking out along
    // each side — the widest, flattest surface in the whole render, sitting where
    // nothing should be. Tapering it makes the machine one silhouette.
    const taper = LAYOUT.taper;
    const outerAt = (z: number) => {
      const w = halfWidth + ((taper.frontHalfWidth - halfWidth) * (z - taper.startZ)) / (table.frontZ - taper.startZ);
      return w + wallThickness;
    };
    // rear section: straight, full width
    const rearDepth = taper.startZ - plinthBack;
    const rear = new THREE.Mesh(
      new THREE.BoxGeometry((halfWidth + wallThickness) * 2, plinthTop - groundY, rearDepth),
      this.mats.frame
    );
    rear.position.set(0, (plinthTop + groundY) / 2, (plinthBack + taper.startZ) / 2);
    rear.receiveShadow = true;
    this.group.add(rear);
    // front section: a trapezoid prism, convex so one hull collider would cover it
    // (visual only here — the table above carries the play surface)
    const wA = outerAt(taper.startZ);
    const wB = outerAt(plinthFront);
    const yTop = plinthTop;
    const yBot = groundY;
    const hull = new ConvexGeometry([
      new THREE.Vector3(-wA, yBot, taper.startZ), new THREE.Vector3(wA, yBot, taper.startZ),
      new THREE.Vector3(-wB, yBot, plinthFront), new THREE.Vector3(wB, yBot, plinthFront),
      new THREE.Vector3(-wA, yTop, taper.startZ), new THREE.Vector3(wA, yTop, taper.startZ),
      new THREE.Vector3(-wB, yTop, plinthFront), new THREE.Vector3(wB, yTop, plinthFront),
    ]);
    hull.computeVertexNormals();
    const front = new THREE.Mesh(hull, this.mats.frame);
    front.receiveShadow = true;
    this.group.add(front);

    // Glowing accent rails hugging the OUTER face of the side walls. They follow
    // the taper for the same reason the glass does: run them straight and the
    // front half floats out in space with nothing under it, which reads as a
    // modelling mistake rather than a machine.
    const yaw = Math.atan2(halfWidth - taper.frontHalfWidth, table.frontZ - taper.startZ);
    const railY = LAYOUT.wallHeight + 0.1;
    const outer = halfWidth + wallThickness + 0.03;
    for (const sx of [-1, 1]) {
      // rear run — straight
      const backLen = taper.startZ - backZ;
      const rear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, backLen), this.mats.accent);
      rear.position.set(sx * outer, railY, (backZ + taper.startZ) / 2);
      this.group.add(rear);
      // front run — angled with the wall
      const angLen = Math.hypot(halfWidth - taper.frontHalfWidth, table.frontZ - taper.startZ);
      const angWc = (halfWidth + taper.frontHalfWidth) / 2 + wallThickness + 0.03;
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, angLen), this.mats.accent);
      front.position.set(sx * angWc, railY, (taper.startZ + table.frontZ) / 2);
      front.setRotationFromEuler(new THREE.Euler(0, -sx * yaw, 0));
      this.group.add(front);
    }
  }

  /** Top face of the rear housing — the back case-frame posts stand on it. */
  private static readonly HOUSING_TOP = 2.55;

  /** Opaque housing enclosing the mechanism behind the back wall (the table's
   *  rear extent and the pusher deck's travel). Purely visual — it hides the
   *  exposed innards that were visible from the sides, so the cabinet reads as
   *  one solid body with no floating parts. */
  private buildRearHousing(): void {
    const { halfWidth, wallThickness, table, backWallZ } = LAYOUT;
    const front = backWallZ - 0.02; // meets the side walls' rear edge (no side slit)
    const back = table.backZ - 0.08; // slightly inside the plinth's rear face
    const top = PusherCabinet.HOUSING_TOP; // just under the seated monitor's head unit
    const bottom = table.y - table.thickness; // stands on the plinth top
    // inset 0.02 from the wall/plinth faces so no two faces are coplanar (z-fight)
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry((halfWidth + wallThickness - 0.02) * 2, top - bottom, front - back),
      this.mats.frame
    );
    housing.position.set(0, (top + bottom) / 2, (front + back) / 2);
    housing.castShadow = true;
    housing.receiveShadow = true;
    this.group.add(housing);
  }

  /** Metal frame for the glass showcase: corner posts, a top perimeter and a
   *  front sill along the payout mouth. The glass panes are nearly invisible, so
   *  without framed edges the case read as unfinished floating slabs; the frame
   *  also plugs the small open corner columns where the panes don't meet. Purely
   *  visual (the gaps are far smaller than a coin). */
  private buildCaseFrame(): void {
    const { halfWidth, wallThickness, table, monitor, taper } = LAYOUT;
    // same enclosure extents as buildCover
    const ceilingY = monitor.y + monitor.height / 2 + 0.35;
    const frontZ = table.frontZ + wallThickness / 2 - 0.02; // front glass plane
    const backZ = monitor.z - 0.6 - wallThickness / 2; // back glass plane
    const px = halfWidth + wallThickness / 2; // rear post centre = wall centre line
    // The FRONT of the case follows the playfield in: posts, top rail and sill all
    // sit at the tapered width. Left at the rear width they stand three-quarters
    // of a metre outboard of the glass they are supposed to be framing, floating
    // with nothing beneath them.
    const fpx = taper.frontHalfWidth + wallThickness / 2;
    const yaw = Math.atan2(px - fpx, frontZ - taper.startZ);

    const bar = (
      cx: number, cy: number, cz: number,
      hx: number, hy: number, hz: number, euler?: THREE.Euler
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), this.mats.frame);
      m.position.set(cx, cy, cz);
      if (euler) m.setRotationFromEuler(euler);
      m.castShadow = true;
      this.group.add(m);
    };

    const railTop = ceilingY + 0.03;
    const b0 = PusherCabinet.HOUSING_TOP;
    for (const sx of [-1, 1]) {
      // front posts — on the NARROW front line
      bar(sx * fpx, (railTop - 0.2) / 2, frontZ, 0.1, (railTop + 0.2) / 2, 0.11);
      // back posts stand on the rear housing
      bar(sx * px, (b0 + railTop) / 2, backZ, 0.1, (railTop - b0) / 2, 0.12);
      // side top rails: straight to the taper start, then angled in to the posts
      bar(sx * px, railTop, (backZ + taper.startZ) / 2, 0.1, 0.08, (taper.startZ - backZ) / 2);
      const angLen = Math.hypot(px - fpx, frontZ - taper.startZ) / 2;
      bar(
        sx * (px + fpx) / 2, railTop, (taper.startZ + frontZ) / 2,
        0.1, 0.08, angLen,
        new THREE.Euler(0, -sx * yaw, 0)
      );
    }
    // front / back top rails span across their own posts
    bar(0, railTop, frontZ, fpx + 0.1, 0.08, 0.11);
    bar(0, railTop, backZ, px + 0.1, 0.08, 0.12);
    // front sill — the visible bottom edge of the front glass, right above the
    // payout mouth (coins pass beneath it, same clearance as the glass collider)
    bar(0, 0.9, frontZ, fpx, 0.05, 0.11);
  }

  /** Glowing neon panels along the inner side walls (arcade vibe). */
  private buildNeon(): void {
    const { halfWidth, table, backWallZ, taper } = LAYOUT;
    const straightLen = taper.startZ - backWallZ;
    const straightCz = (backWallZ + taper.startZ) / 2;
    const yaw = Math.atan2(halfWidth - taper.frontHalfWidth, table.frontZ - taper.startZ);
    const angLen = Math.hypot(halfWidth - taper.frontHalfWidth, table.frontZ - taper.startZ);
    const angCz = (taper.startZ + table.frontZ) / 2;
    const angWc = (halfWidth + taper.frontHalfWidth) / 2;

    for (const sx of [-1, 1]) {
      for (const [y, mat] of [
        [0.5, this.mats.neonBlue],
        [1.1, this.mats.neonPink],
      ] as const) {
        // rear run — straight
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, straightLen * 0.96), mat);
        back.position.set(sx * (halfWidth - 0.01), y, straightCz);
        this.group.add(back);
        // front run — angled with the taper, so the strip stays on the wall face
        const front = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, angLen * 0.96), mat);
        front.position.set(sx * (angWc - 0.01), y, angCz);
        front.setRotationFromEuler(new THREE.Euler(0, -sx * yaw, 0));
        this.group.add(front);
      }
    }
  }

  /** Back-top monitor: a tilted screen above the back wall where minigames are
   *  displayed. Bezel + dark screen + neon trim. */
  private buildBackDisplay(): void {
    const m = LAYOUT.monitor;
    const monitor = new THREE.Group();
    monitor.position.set(m.x, m.y, m.z);
    monitor.rotation.x = m.rotX;

    // bezel (frame around the screen)
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(m.width + 0.3, m.height + 0.3, 0.22),
      this.mats.frame
    );
    bezel.position.z = -0.06;
    bezel.castShadow = true;
    monitor.add(bezel);

    // solid head housing behind the bezel — from the side the monitor reads as a
    // real display unit with depth, not a floating thin panel
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(m.width * 0.8, m.height * 0.85, 0.34),
      this.mats.frame
    );
    head.position.z = -0.34;
    head.castShadow = true;
    monitor.add(head);

    // dark glossy screen
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(m.width, m.height),
      new THREE.MeshStandardMaterial({
        color: 0x05070f,
        metalness: 0.4,
        roughness: 0.25,
        emissive: 0x0a1430,
        emissiveIntensity: 0.6,
      })
    );
    screen.position.z = 0.06;
    monitor.add(screen);

    // neon trim around the bezel
    for (const [w, h, x, y] of [
      [m.width + 0.3, 0.06, 0, (m.height + 0.3) / 2],
      [m.width + 0.3, 0.06, 0, -(m.height + 0.3) / 2],
      [0.06, m.height + 0.3, (m.width + 0.3) / 2, 0],
      [0.06, m.height + 0.3, -(m.width + 0.3) / 2, 0],
    ] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.26), this.mats.neonBlue);
      bar.position.set(x, y, 0.0);
      monitor.add(bar);
    }

    this.group.add(monitor);
  }

  /** Transparent top cover (glass ceiling + clear upper side/back/front panels) so
   *  a jackpot burst of coins can't fly out of the cabinet. The bottom front edge
   *  stays open below the front panel so coins can still fall off into the payout. */
  /** An angled glass pane (visual + rotated collider), for the tapered sides. */
  private rotatedGlass(
    mat: THREE.Material,
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    euler: THREE.Euler
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
    mesh.position.set(cx, cy, cz);
    mesh.setRotationFromEuler(euler);
    mesh.renderOrder = 2;
    this.group.add(mesh);
    const q = new THREE.Quaternion().setFromEuler(euler);
    const c = this.physics.RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setRestitution(0.1)
      .setFriction(0.2)
      .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
    this.physics.registerCollider(this.physics.world.createCollider(c, this.body), {
      tag: BodyTag.Static,
    });
  }

  private buildCover(): void {
    const { halfWidth, wallThickness, wallHeight, table, monitor } = LAYOUT;
    const frontZ = table.frontZ;
    const wallTop = wallHeight + 0.2; // opaque wall top (uniform all around)
    // raise the ceiling above the back-top monitor, and extend the enclosure back
    // far enough to also cover the monitor (which sits behind the back wall).
    const ceilingY = monitor.y + monitor.height / 2 + 0.35;
    const encBack = monitor.z - 0.6; // behind the monitor
    const cz = (encBack + frontZ) / 2;
    const hz = (frontZ - encBack) / 2;

    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x9fd4ff,
      transparent: true,
      opacity: 0.06,
      roughness: 0.1,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const addGlass = (cx: number, cy: number, czz: number, hx: number, hy: number, hzz: number, render = true) => {
      // `render: false` keeps the collider (coins stay contained) but draws nothing
      // — used for the ceiling so the top is COMPLETELY transparent.
      if (render) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hzz * 2), glass);
        mesh.position.set(cx, cy, czz);
        mesh.renderOrder = 2;
        this.group.add(mesh);
      }
      const c = this.physics.RAPIER.ColliderDesc.cuboid(hx, hy, hzz)
        .setTranslation(cx, cy, czz)
        .setRestitution(0.1)
        .setFriction(0.2)
        .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
      this.physics.registerCollider(this.physics.world.createCollider(c, this.body), {
        tag: BodyTag.Static,
      });
    };

    // tall glass ceiling spanning the field AND the monitor recess — COMPLETELY
    // transparent (collider only) per design: no visible top pane.
    addGlass(0, ceilingY, cz, halfWidth + wallThickness, 0.05, hz, false);
    // Clear side walls from the opaque wall top up to the ceiling. These FOLLOW
    // THE TAPER: run them straight and they sit outboard of the angled walls
    // below, leaving a ledge along each side at wall-top height — exactly the
    // kind of shelf coins perch on, which is what the sloped メダル返し caps used
    // to exist to defeat. Sitting flush on the walls, there is no ledge at all.
    const upCY = (wallTop + ceilingY) / 2;
    const upHY = (ceilingY - wallTop) / 2;
    const taper = LAYOUT.taper;
    const straightBack = encBack;
    const straightFront = taper.startZ;
    const yaw = Math.atan2(halfWidth - taper.frontHalfWidth, frontZ - taper.startZ);
    for (const sx of [-1, 1]) {
      // rear section — straight, full width
      addGlass(
        sx * (halfWidth + wallThickness / 2), upCY,
        (straightBack + straightFront) / 2,
        wallThickness / 2, upHY, (straightFront - straightBack) / 2
      );
      // front section — angled to match the trapezoid below it
      const zc = (taper.startZ + frontZ) / 2;
      const wc = (halfWidth + taper.frontHalfWidth) / 2;
      const len = Math.hypot(halfWidth - taper.frontHalfWidth, frontZ - taper.startZ) / 2;
      this.rotatedGlass(
        glass,
        sx * (wc + (wallThickness / 2) * Math.cos(yaw)), upCY, zc,
        wallThickness / 2, upHY, len,
        new THREE.Euler(0, -sx * yaw, 0)
      );
    }
    // clear back wall behind the monitor, full height up to the ceiling
    addGlass(0, ceilingY / 2, encBack - wallThickness / 2, halfWidth + wallThickness, ceilingY / 2, wallThickness / 2);
    // clear front panel ABOVE the payout gap — bottom raised so coins AND balls
    // (Ø~0.64) roll off the edge underneath it without snagging
    const frontBottom = 0.85;
    addGlass(0, (frontBottom + ceilingY) / 2, frontZ + wallThickness / 2, LAYOUT.taper.frontHalfWidth, (ceilingY - frontBottom) / 2, wallThickness / 2);
  }
}
