import * as THREE from 'three';
import { bus } from '../core/EventBus';
import { LAYOUT } from '../pusher/layout';

/**
 * Pointer/keyboard/touch input. Clicking the playfield drops a medal at the
 * aimed X (raycast onto the table plane). Space drops at the last X. The
 * `enabled` flag is toggled by the state machine so minigames can capture input.
 */
export class InputManager {
  enabled = true;
  /** normalized aim (-1..1) from the pointer, for the insertion rail */
  aimNorm = 0;
  /** when set, pointer events are forwarded here instead of dropping medals */
  capture: ((nx: number, ny: number, down: boolean) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LAYOUT.table.y);
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private lastX = 0;
  private pointerDown = false;
  private holdTimer = 0;
  // free-camera drag: 'orbit' (right button) or 'pan' (middle button)
  private dragMode: 'orbit' | 'pan' | null = null;
  private dragX = 0;
  private dragY = 0;

  constructor(private canvas: HTMLCanvasElement, private getCamera: () => THREE.Camera) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private toNdc(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.aimNorm = Math.max(-1, Math.min(1, this.ndc.x));
  }

  private aimX(): number | null {
    this.raycaster.setFromCamera(this.ndc, this.getCamera());
    const ok = this.raycaster.ray.intersectPlane(this.plane, this.hit);
    if (!ok) return null;
    return this.hit.x;
  }

  private onDown = (e: PointerEvent) => {
    this.toNdc(e);
    // right button → orbit the camera, middle button → pan. These work even while
    // a minigame captures the pointer, so the view stays free everywhere.
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      this.dragMode = e.button === 2 ? 'orbit' : 'pan';
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      return;
    }
    if (this.capture) {
      this.capture(this.ndc.x, this.ndc.y, true);
      return;
    }
    if (!this.enabled) return;
    this.pointerDown = true;
    this.holdTimer = 0;
    const x = this.aimX();
    if (x !== null) {
      this.lastX = x;
      bus.emit('input:drop', { x });
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragMode) {
      const dx = e.clientX - this.dragX;
      const dy = e.clientY - this.dragY;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      if (this.dragMode === 'orbit') bus.emit('camera:orbit', { dx, dy });
      else bus.emit('camera:pan', { dx, dy });
      return;
    }
    this.toNdc(e);
    if (this.capture) {
      this.capture(this.ndc.x, this.ndc.y, this.pointerDown);
      return;
    }
    const x = this.aimX();
    if (x !== null) this.lastX = x;
  };

  private onUp = (e: PointerEvent) => {
    if (this.dragMode && (e.button === 2 || e.button === 1)) {
      this.dragMode = null;
      return;
    }
    this.pointerDown = false;
    if (this.capture) this.capture(this.ndc.x, this.ndc.y, false);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    bus.emit('camera:zoom', { delta: e.deltaY });
  };

  private onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'ArrowLeft') this.aimNorm = Math.max(-1, this.aimNorm - 0.12);
    else if (e.code === 'ArrowRight') this.aimNorm = Math.min(1, this.aimNorm + 0.12);
    if (e.repeat) return;
    if (e.code === 'Space' && this.enabled && !this.capture) {
      e.preventDefault();
      bus.emit('input:drop', { x: this.lastX });
    }
  };

  /** Auto-repeat drops while the pointer is held down. */
  update(dt: number): void {
    if (!this.pointerDown || this.capture || !this.enabled) return;
    this.holdTimer += dt;
    if (this.holdTimer >= 0.12) {
      this.holdTimer = 0;
      bus.emit('input:drop', { x: this.lastX });
    }
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }
}
