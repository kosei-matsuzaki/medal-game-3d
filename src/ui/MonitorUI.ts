import * as THREE from 'three';
import { bus } from '../core/EventBus';
import { LAYOUT } from '../pusher/layout';
import { create2D, textPlane, textTexture } from '../render/canvasText';
import { anchorToMonitor } from './monitorAnchor';

/**
 * Persistent chrome for the back-top monitor: a styled backdrop (vignette +
 * scanlines), a glowing header, and a FEVER banner that lights up while FEVER is
 * active. The slot / stock content render in FRONT of this; this gives the screen
 * an intentional "display" look instead of a bare dark panel.
 */
export class MonitorUI {
  private group = new THREE.Group();
  private feverBanner!: THREE.Mesh;
  private feverActive = false;
  private t = 0;
  // live "monitor" layers + reach/win reaction overlay
  private scan!: THREE.Mesh;
  private wash!: THREE.Mesh;
  private reachText!: THREE.Mesh;
  private reachTex!: THREE.CanvasTexture;
  private reachTexSuper!: THREE.CanvasTexture;
  private reachOn = false;
  private reachSuper = false;
  private reachT = 0;
  private washColor = new THREE.Color(0xffffff);
  private washLevel = 0;

  constructor(scene: THREE.Scene) {
    const m = LAYOUT.monitor;
    anchorToMonitor(this.group);

    // NOTE: all layers here live within a few mm of the screen surface (the
    // anchor plane) so the whole UI reads as a FLAT image on the display —
    // nothing pokes out of the monitor. Layering is by tiny z steps only.

    // bezel art framing the screen — drawn flush over the physical frame, just
    // BEHIND the screen surface so only its border ring shows around the screen
    const bezel = new THREE.Mesh(
      new THREE.PlaneGeometry(m.width + 0.34, m.height + 0.34),
      new THREE.MeshBasicMaterial({ map: this.bezelTexture(), transparent: true })
    );
    bezel.position.z = -0.025;
    this.group.add(bezel);

    // backdrop: the screen's idle image, right on the glass, behind slot content
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(m.width - 0.1, m.height - 0.1),
      new THREE.MeshBasicMaterial({ map: this.backdropTexture(), transparent: true })
    );
    backdrop.position.z = -0.012;
    this.group.add(backdrop);

    // FEVER banner (hidden until FEVER) — overlays the top of the screen
    this.feverBanner = textPlane(
      '🔥 F E V E R 🔥',
      { font: '900 110px "Segoe UI", sans-serif', color: ['#fff', '#ffe24a', '#ff4da6'], glow: '#ff4da6', glowBlur: 26 },
      1024, 200, 3.9, 0.78
    );
    this.feverBanner.position.set(0, m.height / 2 - 0.42, 0.01);
    this.feverBanner.visible = false;
    this.group.add(this.feverBanner);

    // scrolling scanline overlay in FRONT of everything → live CRT/monitor feel
    this.scan = new THREE.Mesh(
      new THREE.PlaneGeometry(m.width - 0.06, m.height - 0.06),
      new THREE.MeshBasicMaterial({
        map: this.scanTexture(),
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.scan.position.z = 0.016;
    this.group.add(this.scan);

    // full-screen colour wash for reach / win reactions (additive, fades out)
    this.wash = new THREE.Mesh(
      new THREE.PlaneGeometry(m.width - 0.02, m.height - 0.02),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.wash.position.z = 0.014;
    this.group.add(this.wash);

    // big reach callout — hidden until a reach fires (two variants)
    this.reachTex = textTexture(1024, 220, 'リ ー チ !!', {
      font: '900 128px "Segoe UI", sans-serif',
      color: ['#fff', '#ffd34d', '#ff9d12'],
      glow: '#ffb030',
      glowBlur: 30,
    });
    this.reachTexSuper = textTexture(1024, 220, '激 ア ツ !!', {
      font: '900 128px "Segoe UI", sans-serif',
      color: ['#fff', '#ff8a5a', '#ff2b5e'],
      glow: '#ff3b5e',
      glowBlur: 38,
    });
    this.reachText = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.8),
      new THREE.MeshBasicMaterial({ map: this.reachTex, transparent: true, depthWrite: false })
    );
    this.reachText.position.set(0, -0.12, 0.018);
    this.reachText.visible = false;
    this.group.add(this.reachText);

    scene.add(this.group);
    bus.on('fever:changed', ({ active }) => this.setFever(active));
    bus.on('slot:reach', ({ super: sup }) => this.onReach(sup));
    bus.on('slot:outcome', ({ kind }) => this.onOutcome(kind));
  }

  private onReach(sup: boolean): void {
    this.reachOn = true;
    this.reachSuper = sup;
    this.reachT = 0;
    const mat = this.reachText.material as THREE.MeshBasicMaterial;
    mat.map = sup ? this.reachTexSuper : this.reachTex;
    mat.needsUpdate = true;
    this.reachText.visible = true;
    this.flash(sup ? 0xff2b5e : 0x36e0ff, sup ? 0.9 : 0.55);
  }

  private onOutcome(kind: 'bigwin' | 'win' | 'near' | 'miss'): void {
    this.reachOn = false;
    this.reachText.visible = false;
    if (kind === 'bigwin') this.flash(0xffe24a, 1.0);
    else if (kind === 'win') this.flash(0xffd060, 0.7);
    else if (kind === 'near') this.flash(0x3a6bff, 0.45);
  }

  /** Trigger a colour-wash pulse over the screen. */
  private flash(color: number, level: number): void {
    this.washColor.setHex(color);
    this.washLevel = Math.max(this.washLevel, level);
  }

  private setFever(active: boolean): void {
    this.feverActive = active;
    this.feverBanner.visible = active;
  }

  /** Debug/testing: is the FEVER banner currently shown on the monitor? */
  get feverShown(): boolean {
    return this.feverBanner.visible;
  }

  update(dt: number): void {
    this.t += dt;

    // scrolling scanlines + faint irregular flicker → real CRT/monitor feel
    const sm = this.scan.material as THREE.MeshBasicMaterial;
    if (sm.map) sm.map.offset.y = (sm.map.offset.y + dt * 0.35) % 1;
    sm.opacity = 0.08 + (Math.sin(this.t * 13.3) * 0.5 + 0.5) * 0.035 + (Math.sin(this.t * 47) > 0.9 ? 0.05 : 0);

    // reach callout throb + keep the wash pulsing while the reach is live
    if (this.reachOn) {
      this.reachT += dt;
      const p = this.reachSuper ? 14 : 9;
      const s = 1 + Math.sin(this.reachT * p) * 0.1;
      this.reachText.scale.set(s, s, 1);
      (this.reachText.material as THREE.MeshBasicMaterial).opacity = 0.8 + Math.sin(this.reachT * p) * 0.2;
      const base = this.reachSuper ? 0.3 : 0.16;
      this.washLevel = Math.max(this.washLevel, base * (0.6 + 0.4 * Math.sin(this.reachT * p)));
    }

    // colour-wash fade
    const wm = this.wash.material as THREE.MeshBasicMaterial;
    this.washLevel = Math.max(0, this.washLevel - dt * 1.4);
    wm.color.copy(this.washColor);
    wm.opacity = this.washLevel * 0.5;

    if (!this.feverActive) return;
    const s = 1 + Math.sin(this.t * 9) * 0.06;
    this.feverBanner.scale.set(s, s, 1);
    (this.feverBanner.material as THREE.MeshBasicMaterial).opacity = 0.85 + Math.sin(this.t * 9) * 0.15;
  }

  /** Fine repeating scanlines that scroll vertically (monitor refresh feel). */
  private scanTexture(): THREE.CanvasTexture {
    const [c, g] = create2D(8, 64);
    for (let y = 0; y < 64; y += 3) {
      g.fillStyle = 'rgba(150,200,255,0.5)';
      g.fillRect(0, y, 8, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 10);
    return tex;
  }

  /** Glossy dark bezel with rounded neon edge — the monitor's physical frame. */
  private bezelTexture(): THREE.CanvasTexture {
    const [c, g] = create2D(512, 300);
    const grad = g.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, '#1a1f30');
    grad.addColorStop(0.5, '#0a0d18');
    grad.addColorStop(1, '#05070e');
    g.fillStyle = grad;
    this.roundRect(g, 0, 0, 512, 300, 28);
    g.fill();
    // outer neon edge
    g.strokeStyle = 'rgba(70,170,255,0.55)';
    g.lineWidth = 6;
    g.shadowColor = 'rgba(70,170,255,0.7)';
    g.shadowBlur = 18;
    this.roundRect(g, 10, 10, 492, 280, 22);
    g.stroke();
    // inner gold seam
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,200,90,0.5)';
    g.lineWidth = 2;
    this.roundRect(g, 26, 26, 460, 248, 16);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private roundRect(
    g: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
  ): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /** Dark vignette + scanline backdrop so the idle screen looks like a display. */
  private backdropTexture(): THREE.CanvasTexture {
    const [c, g] = create2D(512, 288);
    const grad = g.createRadialGradient(256, 130, 40, 256, 144, 320);
    grad.addColorStop(0, '#10204a');
    grad.addColorStop(0.55, '#070d22');
    grad.addColorStop(1, '#03040c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 288);
    // subtle scanlines
    g.globalAlpha = 0.06;
    g.fillStyle = '#7fbfff';
    for (let y = 0; y < 288; y += 4) g.fillRect(0, y, 512, 1);
    g.globalAlpha = 1;
    // inner border glow
    g.strokeStyle = 'rgba(60,160,255,0.35)';
    g.lineWidth = 4;
    g.strokeRect(8, 8, 496, 272);
    // corner brackets for a HUD/display feel
    g.strokeStyle = 'rgba(255,200,90,0.7)';
    g.lineWidth = 5;
    const L = 34, p = 18;
    const corner = (cx: number, cy: number, dx: number, dy: number) => {
      g.beginPath();
      g.moveTo(cx, cy + dy * L);
      g.lineTo(cx, cy);
      g.lineTo(cx + dx * L, cy);
      g.stroke();
    };
    corner(p, p, 1, 1);
    corner(512 - p, p, -1, 1);
    corner(p, 288 - p, 1, -1);
    corner(512 - p, 288 - p, -1, -1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
