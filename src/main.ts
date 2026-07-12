import { Game } from './core/Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

const game = new Game(canvas);
game.start().catch((err) => {
  console.error('Game failed to start:', err);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = '起動に失敗しました（コンソールを確認）';
});
