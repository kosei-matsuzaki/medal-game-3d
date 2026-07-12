import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type QualityTier = 'high' | 'medium' | 'low';

/**
 * Single merged-pass post pipeline: RenderPass -> N8AO -> EffectPass(Bloom +
 * SMAA + Tonemap + Vignette). Bloom intensity is exposed so jackpot moments
 * can spike it.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  private ao?: N8AOPostPass;
  private baseBloom: number;
  private bloomBoost = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    tier: QualityTier = 'high'
  ) {
    // The tonemapping effect handles tone mapping; disable on the renderer to
    // avoid applying it twice.
    renderer.toneMapping = THREE.NoToneMapping;

    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    this.composer.addPass(new RenderPass(scene, camera));

    if (tier !== 'low') {
      const ao = new N8AOPostPass(
        scene,
        camera,
        window.innerWidth,
        window.innerHeight
      );
      ao.configuration.aoRadius = 1.4;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = tier === 'high' ? 3.0 : 2.2;
      ao.configuration.color = new THREE.Color(0, 0, 0);
      ao.setQualityMode(tier === 'high' ? 'High' : 'Medium');
      this.composer.addPass(ao);
      this.ao = ao;
    }

    this.baseBloom = 0.85;
    this.bloom = new BloomEffect({
      intensity: this.baseBloom,
      luminanceThreshold: 0.78,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.7,
    });

    const smaa = new SMAAEffect({
      preset: tier === 'high' ? SMAAPreset.ULTRA : SMAAPreset.MEDIUM,
    });

    const tonemap = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });

    const vignette = new VignetteEffect({
      blendFunction: BlendFunction.NORMAL,
      offset: 0.32,
      darkness: 0.62,
    });

    this.composer.addPass(
      new EffectPass(camera, this.bloom, smaa, tonemap, vignette)
    );
  }

  /** Temporary additive bloom boost (e.g. jackpot flash), decays over time. */
  pulseBloom(amount: number): void {
    this.bloomBoost = Math.max(this.bloomBoost, amount);
  }

  update(dt: number): void {
    if (this.bloomBoost > 0) {
      this.bloomBoost = Math.max(0, this.bloomBoost - dt * 1.5);
    }
    this.bloom.intensity = this.baseBloom + this.bloomBoost;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.ao?.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
