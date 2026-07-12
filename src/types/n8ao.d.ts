declare module 'n8ao' {
  import * as THREE from 'three';
  import { Pass } from 'postprocessing';

  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: THREE.Color;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      [key: string]: unknown;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
