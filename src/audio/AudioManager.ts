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
    this.master = this.ctx.createGain();
    this.master.gain.value = this.save.get().settings.muted ? 0 : this.save.get().settings.volume;
    this.master.connect(this.ctx.destination);
    this.unlocked = true;
  }

  toggleMute(): boolean {
    const s = this.save.get().settings;
    s.muted = !s.muted;
    this.save.save();
    if (this.master) this.master.gain.value = s.muted ? 0 : s.volume;
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
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain = 0.2, hp = 800): void {
    if (!this.ctx) return;
    const t = this.now();
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }

  play(name: SfxName): void {
    if (!this.ctx || this.save.get().settings.muted) return;
    switch (name) {
      case 'drop':
        this.tone(420, 0.08, 'triangle', 0.18, 300);
        break;
      case 'coin':
        this.tone(1200, 0.06, 'square', 0.1, 1600);
        break;
      case 'chucker':
        this.tone(660, 0.12, 'triangle', 0.25, 990);
        this.tone(990, 0.12, 'sine', 0.18);
        break;
      case 'reel':
        this.tone(180, 0.04, 'square', 0.08);
        break;
      case 'reelstop':
        this.tone(300, 0.1, 'square', 0.2, 160);
        this.noise(0.05, 0.1);
        break;
      case 'spin':
        this.tone(220, 0.5, 'sawtooth', 0.1, 880);
        break;
      case 'win':
        [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.25), i * 90));
        break;
      case 'bigwin':
        [523, 659, 784, 1046].forEach((f, i) =>
          setTimeout(() => this.tone(f, 0.22, 'square', 0.22), i * 110)
        );
        break;
      case 'jackpot':
        [523, 659, 784, 1046, 1318, 1568].forEach((f, i) =>
          setTimeout(() => {
            this.tone(f, 0.3, 'square', 0.25);
            this.tone(f * 1.5, 0.3, 'sine', 0.12);
          }, i * 120)
        );
        this.noise(0.6, 0.12, 400);
        break;
      case 'click':
        this.tone(800, 0.03, 'square', 0.12);
        break;
      case 'reach':
        // rising tension bed + accelerating heartbeat beeps ("当たりそう！")
        this.tone(260, 1.7, 'sawtooth', 0.11, 1300);
        [0, 1, 2, 3, 4, 5].forEach((i) =>
          setTimeout(() => this.tone(560 + i * 70, 0.08, 'square', 0.13), i * 170)
        );
        break;
      case 'nearmiss':
        // deflating "aww" — a quick downward slide
        this.tone(520, 0.45, 'sine', 0.2, 150);
        break;
    }
  }
}
