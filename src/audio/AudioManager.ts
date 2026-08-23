import { bus } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';

type SfxName =
  | 'drop'
  | 'coin'
  | 'chucker'
  | 'reel'
  | 'reelstop'
  | 'win'
  | 'bigwin'
  | 'jackpot'
  | 'click'
  | 'spin'
  | 'reach'
  | 'nearmiss';

/**
 * Procedural Web Audio SFX — no external files required. Sounds are synthesised
 * from oscillators/noise so the game ships asset-free. Music/voice can later be
 * layered in without changing this interface.
 */
/**
 * Overall loudness headroom. Voices are mixed hot for clarity, so we scale the
 * master bus down and let the limiter catch any remaining peaks. This is the
 * main knob for "how loud is the game overall".
 */
const HEADROOM = 0.55;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private unlocked = false;

  constructor(private save: SaveManager) {
    bus.on('sfx', ({ name }) => this.play(name as SfxName));
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  }

  private unlock(): void {
    if (this.unlocked) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Voices connect to `master`; the signal then passes through a gentle
    // low-pass "glue" bus (removes the piercing top harmonics of the synth
    // waveforms) and a limiter (stops overlapping tones from clipping/hurting).
    this.master = this.ctx.createGain();

    const glue = this.ctx.createBiquadFilter();
    glue.type = 'lowpass';
    glue.frequency.value = 5200; // roll off the harsh, ear-piercing top end
    glue.Q.value = 0.4;

    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 24;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;

    this.master.gain.value = this.gainFor();
    this.master.connect(glue).connect(limiter).connect(this.ctx.destination);
    this.unlocked = true;
  }

  private gainFor(): number {
    const s = this.save.get().settings;
    return s.muted ? 0 : s.volume * HEADROOM;
  }

  toggleMute(): boolean {
    const s = this.save.get().settings;
    s.muted = !s.muted;
    this.save.save();
    if (this.master) this.master.gain.value = this.gainFor();
    return s.muted;
  }

  private now(): number {
    return this.ctx!.currentTime;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    gain = 0.3,
    glideTo?: number
  ): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    // Softer attack (~18ms) avoids the sharp "click" transient; exponential
    // decay across the full duration gives a natural, non-fatiguing tail.
    const attack = Math.min(0.018, dur * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain = 0.12, hp = 600): void {
    if (!this.ctx) return;
    const t = this.now();
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Band-limit the noise: high-pass to shape it, then a low-pass to strip the
    // brittle "sss" fizz that makes white noise fatiguing.
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = hp;
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 3200;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(hpf).connect(lpf).connect(g).connect(this.master);
    src.start(t);
  }

  play(name: SfxName): void {
    if (!this.ctx || this.save.get().settings.muted) return;
    switch (name) {
      case 'drop':
        this.tone(400, 0.09, 'triangle', 0.15, 300);
        break;
      case 'coin':
        // soft bright chime instead of a piercing square blip
        this.tone(880, 0.07, 'triangle', 0.09, 1200);
        break;
      case 'chucker':
        this.tone(640, 0.12, 'triangle', 0.18, 960);
        this.tone(960, 0.12, 'sine', 0.12);
        break;
      case 'reel':
        this.tone(190, 0.045, 'triangle', 0.07);
        break;
      case 'reelstop':
        this.tone(300, 0.11, 'triangle', 0.15, 160);
        this.noise(0.05, 0.07);
        break;
      case 'spin':
        this.tone(220, 0.5, 'triangle', 0.08, 760);
        break;
      case 'win':
        [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 'triangle', 0.18), i * 90));
        break;
      case 'bigwin':
        [523, 659, 784, 1046].forEach((f, i) =>
          setTimeout(() => this.tone(f, 0.24, 'triangle', 0.16), i * 110)
        );
        break;
      case 'jackpot':
        // celebratory arpeggio with a soft octave shimmer — capped frequencies
        // and triangle/sine keep it exciting without stabbing the ears.
        [523, 659, 784, 1046, 1318, 1568].forEach((f, i) =>
          setTimeout(() => {
            this.tone(f, 0.32, 'triangle', 0.16);
            this.tone(f * 1.5, 0.32, 'sine', 0.07);
          }, i * 120)
        );
        this.noise(0.6, 0.07, 400);
        break;
      case 'click':
        this.tone(760, 0.035, 'triangle', 0.09);
        break;
      case 'reach':
        // rising tension bed + accelerating heartbeat beeps ("当たりそう！")
        this.tone(260, 1.7, 'triangle', 0.09, 1000);
        [0, 1, 2, 3, 4, 5].forEach((i) =>
          setTimeout(() => this.tone(540 + i * 60, 0.09, 'triangle', 0.11), i * 170)
        );
        break;
      case 'nearmiss':
        // deflating "aww" — a quick downward slide
        this.tone(520, 0.45, 'sine', 0.16, 150);
        break;
    }
  }
}
