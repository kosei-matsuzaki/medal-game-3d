import { MedalPool } from '../pusher/MedalPool';
import { LAYOUT } from '../pusher/layout';

interface BurstJob {
  remaining: number;
  perTick: number;
  cooldown: number;
  interval: number;
  jackpot: boolean;
}

/**
 * Mass medal release for jackpots/big wins: spawns medals as an upward fountain
 * from the back-center that rains down into the cabinet. Spread over many fixed
 * steps to stay within the pool capacity and keep physics stable.
 */
export class MedalBurst {
  private jobs: BurstJob[] = [];

  constructor(private pool: MedalPool) {}

  fire(total: number, jackpot = true): void {
    this.jobs.push({
      remaining: total,
      perTick: 4,
      cooldown: 0,
      interval: 0.04,
      jackpot,
    });
  }

  fixedUpdate(dt: number): void {
    for (let j = this.jobs.length - 1; j >= 0; j--) {
      const job = this.jobs[j];
      job.cooldown -= dt;
      if (job.cooldown > 0) continue;
      job.cooldown = job.interval;
      const n = Math.min(job.perTick, job.remaining);
      for (let i = 0; i < n; i++) {
        // only spawn if there's pool headroom (above normal cap for spectacle)
        if (this.pool.activeCount >= this.pool.capacity - 2) break;
        const x = (Math.random() - 0.5) * 1.6;
        const z = LAYOUT.chute.z + (Math.random() - 0.5) * 1.2;
        this.pool.spawn(x, LAYOUT.chute.y + 0.6 + Math.random(), z, {
          jackpot: job.jackpot,
          vx: (Math.random() - 0.5) * 4,
          vy: 5 + Math.random() * 4, // fountain up
          vz: (Math.random() - 0.5) * 3,
        });
        job.remaining--;
      }
      if (job.remaining <= 0) this.jobs.splice(j, 1);
    }
  }
}
