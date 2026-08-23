import * as THREE from 'three';
import { createRenderer } from '../render/RendererFactory';
import { setupEnvironment } from '../render/Environment';
import { setupLighting } from '../render/Lighting';
import { setupFloor } from '../render/Floor';
import { PostFX, QualityTier } from '../render/PostFX';
import { CameraRig } from '../camera/CameraRig';

/** Owns the renderer, scene, camera rig, environment/lighting and post FX. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cameraRig: CameraRig;
  postfx!: PostFX;
  private tier: QualityTier;

  constructor(canvas: HTMLCanvasElement, tier: QualityTier = 'high') {
    this.tier = tier;
    this.renderer = createRenderer(canvas);
    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
    setupLighting(this.scene);
    setupFloor(this.scene);
    window.addEventListener('resize', this.onResize);
  }

  async init(): Promise<void> {
    await setupEnvironment(this.renderer, this.scene);
    this.postfx = new PostFX(this.renderer, this.scene, this.cameraRig.camera, this.tier);
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.cameraRig.resize(w / h);
    this.postfx?.setSize(w, h);
  };

  render(): void {
    this.postfx.render();
  }
}
