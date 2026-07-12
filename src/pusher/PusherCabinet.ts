import * as THREE from 'three';
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
    this.buildWallCaps();
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
    const { table, halfWidth } = LAYOUT;
    const ty = table.y - table.thickness / 2;
    const hyT = table.thickness / 2;
    // FLAT full-width ground from the back (under the pusher) to the open front edge
    this.tableSegment(-halfWidth, halfWidth, table.backZ, table.frontZ, ty, hyT);
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
    // left & right (only span the visible field)
    for (const sx of [-1, 1]) {
      this.solidBox(
        sx * (halfWidth + wallThickness / 2),
        cy,
        cz,
        wallThickness / 2,
        hy,
        depth / 2,
        this.mats.frame
      );
    }
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

  /** A static box with an arbitrary rotation (mesh + matching rotated collider). */
  private slopedBox(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    euler: THREE.Euler, mat: THREE.Material
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
    mesh.position.set(cx, cy, cz);
    mesh.setRotationFromEuler(euler);
    mesh.castShadow = true;
    this.group.add(mesh);
    const q = new THREE.Quaternion().setFromEuler(euler);
    const cd = this.physics.RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.3)
      .setRestitution(0.04)
      .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
    const collider = this.physics.world.createCollider(cd, this.body);
    this.physics.registerCollider(collider, { tag: BodyTag.Static });
  }

  /** Sloped caps on the wall tops so coins can't balance on a flat ledge (they
   *  slide back into the field). The side caps slope inward; the back cap slopes
   *  forward. Widths/positions match the walls below them. */
  private buildWallCaps(): void {
    const { halfWidth, wallThickness, wallHeight, table, backWallZ } = LAYOUT;
    const visBack = backWallZ;
    const depth = table.frontZ - visBack;
    const cz = (table.frontZ + visBack) / 2;
    const sideTop = wallHeight + 0.2; // top of the opaque side walls (= back wall top)
    const slope = 0.62; // ~35° — steeper than the medal angle of repose

    // side caps: span the field depth, slope down toward the centre
    for (const sx of [-1, 1]) {
      this.slopedBox(
        sx * halfWidth, sideTop + 0.05, cz,
        0.24, 0.04, depth / 2,
        new THREE.Euler(0, 0, sx * slope), this.mats.frame
      );
    }
    // back cap: full width, slopes down toward the field (+z)
    const backTop = wallHeight + 0.2; // top of the back wall (same level as the sides)
    this.slopedBox(
      0, backTop + 0.04, backWallZ + 0.04,
      halfWidth + wallThickness, 0.04, 0.26,
      new THREE.Euler(0.62, 0, 0), this.mats.frame
    );
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
    const cd = this.physics.RAPIER.ColliderDesc.cuboid(halfWidth, 0.25, fp.halfDepth)
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
    const binHalfW = halfWidth + LAYOUT.wallThickness;
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
        sx * (halfWidth + LAYOUT.wallThickness / 2),
        fp.floorY + wallHalfH,
        fp.z,
        LAYOUT.wallThickness / 2,
        wallHalfH,
        fp.halfDepth,
        this.mats.frame
      );
    }
    // inner glow strip along the bin floor
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 2 - 0.24, 0.02, binDepth - 0.2),
      this.mats.neonBlue
    );
    glow.position.set(0, fp.floorY + 0.06, fp.z);
    this.group.add(glow);

    // glowing lip marking the payout edge (the open front of the field)
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 2, 0.05, 0.05),
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
    const depth = plinthFront - plinthBack;
    const plinthCz = (plinthFront + plinthBack) / 2;
    const plinthTop = table.y - table.thickness; // flush with the table underside
    // same width as the wall/bin outer faces → one flush cabinet body
    const base = new THREE.Mesh(
      new THREE.BoxGeometry((halfWidth + wallThickness) * 2, plinthTop - groundY, depth),
      this.mats.frame
    );
    base.position.set(0, (plinthTop + groundY) / 2, plinthCz);
    base.receiveShadow = true;
    this.group.add(base);

    // glowing accent rails hugging the outer face of the side walls, just under
    // the (now uniform) wall top edge
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, (table.frontZ - backZ) - 1.2),
        this.mats.accent
      );
      rail.position.set(sx * (halfWidth + wallThickness + 0.03), LAYOUT.wallHeight + 0.1, (table.frontZ + backZ) / 2);
      this.group.add(rail);
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
    const { halfWidth, wallThickness, table, monitor } = LAYOUT;
    // same enclosure extents as buildCover
    const ceilingY = monitor.y + monitor.height / 2 + 0.35;
    const frontZ = table.frontZ + wallThickness / 2 - 0.02; // front glass plane
    const backZ = monitor.z - 0.6 - wallThickness / 2; // back glass plane
    const px = halfWidth + wallThickness / 2; // post centre = wall centre line

    const bar = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), this.mats.frame);
      m.position.set(cx, cy, cz);
      m.castShadow = true;
      this.group.add(m);
    };

    const railTop = ceilingY + 0.03;
    for (const sx of [-1, 1]) {
      // front posts: from the plinth top up to the top rail (also cover the open
      // corner between the front and side glass panes)
      bar(sx * px, (railTop - 0.2) / 2, frontZ, 0.1, (railTop + 0.2) / 2, 0.11);
      // back posts: stand on the rear housing
      const b0 = PusherCabinet.HOUSING_TOP;
      bar(sx * px, (b0 + railTop) / 2, backZ, 0.1, (railTop - b0) / 2, 0.12);
      // side top rails
      bar(sx * px, railTop, (frontZ + backZ) / 2, 0.1, 0.08, (frontZ - backZ) / 2);
    }
    // front / back top rails (span across the posts)
    bar(0, railTop, frontZ, px + 0.1, 0.08, 0.11);
    bar(0, railTop, backZ, px + 0.1, 0.08, 0.12);
    // front sill — the visible bottom edge of the front glass, right above the
    // payout mouth (coins pass beneath it, same clearance as the glass collider)
    bar(0, 0.9, frontZ, px, 0.05, 0.11);
  }

  /** Glowing neon panels along the inner side walls (arcade vibe). */
  private buildNeon(): void {
    const { halfWidth, table, backWallZ } = LAYOUT;
    const cz = (table.frontZ + backWallZ) / 2;
    const len = (table.frontZ - backWallZ) * 0.92;
    for (const sx of [-1, 1]) {
      for (const [y, mat] of [
        [0.5, this.mats.neonBlue],
        [1.1, this.mats.neonPink],
      ] as const) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, len), mat);
        // half-sunk into the wall face so the strip reads as mounted, not floating
        panel.position.set(sx * (halfWidth - 0.01), y, cz);
        this.group.add(panel);
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
    // clear side walls from the opaque wall top up to the high ceiling
    const upCY = (wallTop + ceilingY) / 2;
    const upHY = (ceilingY - wallTop) / 2;
    for (const sx of [-1, 1]) {
      addGlass(sx * (halfWidth + wallThickness / 2), upCY, cz, wallThickness / 2, upHY, hz);
    }
    // clear back wall behind the monitor, full height up to the ceiling
    addGlass(0, ceilingY / 2, encBack - wallThickness / 2, halfWidth + wallThickness, ceilingY / 2, wallThickness / 2);
    // clear front panel ABOVE the payout gap — bottom raised so coins AND balls
    // (Ø~0.64) roll off the edge underneath it without snagging
    const frontBottom = 0.85;
    addGlass(0, (frontBottom + ceilingY) / 2, frontZ + wallThickness / 2, halfWidth, (ceilingY - frontBottom) / 2, wallThickness / 2);
  }
}
