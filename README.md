# GOLD RUSH — 3D メダルプッシャー

Three.js + Rapier（物理エンジン）で動く、ブラウザ向けの本格 3D メダルゲーム。
メダルプッシャーを土台に、モニター上のスロット、実物理で抽選する「円盤チャレンジ」、
累積ジャックポットを賭けた「JPチャレンジ」が連鎖するゲームループを実装しています。
**外部アセットは一切不要**（テクスチャ・効果音まですべてコードで手続き生成）で、
`npm install` だけで動きます。

> 作品概要・スクリーンショット・AI 利用については [docs/PORTFOLIO.md](docs/PORTFOLIO.md) を参照してください。

![gameplay](docs/screenshots/01-gameplay.png)

## 動かし方

```bash
npm install
npm run dev          # → http://localhost:5173
# 本番ビルド & 確認
npm run build
npm run preview
```

## 遊び方

| 操作 | 内容 |
| --- | --- |
| クリック / Space | メダル投入（ホールドで連続投入、←→キーで投入位置を調整） |
| 右ドラッグ / ホイール / 中ドラッグ | カメラ自由視点（オービット / ズーム / パン） |
| ` （バッククォート）/ F2 | 開発者パネル（ミニゲーム強制起動・リソース操作） |

### ゲームループ

1. **メダル投入** — 投入したメダルは放物線を描いて奥のデッキに着地し、往復するプッシャーに押される。前縁から落ちたメダルはクレジットとして払い出し。
2. **スロット（ストック式）** — 中央レーンを通ったメダルがスロットの回転をストック（最大10、満杯時は倍率が ×1→×5 に強化）。奥のモニターで自動連続抽選。リーチ・激アツ演出あり。
   - **7揃い** → FEVER 突入（全配当 ×2 ＆ 当選率アップ、偶数揃いで終了）
   - **数字揃い** → 数字×10 枚（×ストック倍率 ×FEVER）
   - **BALL揃い** → 物理ボールがフィールドに排出される
3. **円盤チャレンジ** — ボールが4個フィールドから落ちると発動。回転する円盤にボールが投げ込まれ、**実物理**で6つの穴のどれかに落ちる。ハズレ穴は埋まったまま**セーブをまたいで持ち越される**ため、遊ぶほど JP 穴の確率が上がる（天井あり）。
4. **JPチャレンジ** — 縦回転する大円盤の外周 16 個の U字ポケット（100枚/200枚/300枚/JPC）に、レール上で振り子運動するボールが**物理的に噛み合うまで**挑戦。JPC ポケットで累積ジャックポット獲得。
5. **プレイヤー進行** — 獲得クレジットで EXP が貯まりレベル/ランクアップ（ビギナー→…→レジェンド）。進行状況は localStorage に自動セーブ。

## アーキテクチャ

```
src/
  core/      Engine / Loop(固定タイムステップ 60Hz) / Game / EventBus / debug
  render/    Renderer / Environment(IBL) / Lighting / PostFX(Bloom+N8AO+SMAA)
             materials/ 手続き生成のゴールド・筐体マテリアル / canvasText
  physics/   PhysicsWorld(Rapier ラッパ) / 衝突グループ・タグ
  pusher/    PusherCabinet(筐体) / PusherPlate(kinematic往復+センサ)
             MedalPool(InstancedMesh+ボディプール) / MedalSpawner / DropDetector
             BallManager / layout.ts(全寸法・チューニング値を集約)
  camera/    CameraRig(演出ポーズ補間 + 自由オービット)
  input/     InputManager(pointer/keyboard、カメラ操作の振り分け)
  state/     GameStateMachine / GameStore(observable) / Economy(全RNG・配当)
             SlotStock / Fever / Progression
  minigames/ SlotMachine / DiscChallenge / JackpotChallenge
  fx/        Particles / MedalBurst / JackpotFX
  ui/        HUD(DOM) / MonitorUI(3D画面演出) / StockDisplay / DevPanel
  audio/     AudioManager(Web Audio で全SFXを合成)
  save/      SaveManager(localStorage・バージョン移行)
```

設計の要点:

- **物理が座標を持ち、描画は読むだけ** — Rapier のボディが唯一の真実で、three.js は毎フレーム転写するのみ。
- **メダルは InstancedMesh 2枚**（通常/発光）で全枚数を各1ドローコール。ボディはプール再利用で、最大500枚を安定動作。
- **抽選の二層化** — スロットの確率は `Economy.ts` に集約した RNG、円盤/JPチャレンジは**結果を仕込まない実物理**（落ちた穴・噛んだポケットがそのまま結果）。
- **イベント駆動** — 型付き EventBus で物理・状態・UI・音を疎結合に。
- チューニング値は `src/pusher/layout.ts`（寸法・速度）と `src/state/Economy.ts`（確率・配当）に集約。

## 検証（E2E テスト）

Playwright + headless Chromium による自動テスト。`?debug` で `window.__medal`
デバッグ API（強制遷移・状態取得）が有効になり、テストはそれを介して進行を検証します。

```bash
npx playwright install chromium     # 初回のみ
npm run build
npm run preview -- --port 4176 &
URL=http://localhost:4176/ node test/smoketest.mjs   # 起動・投入・払出・JP積立
URL=http://localhost:4176/ node test/flowtest.mjs    # スロット遷移→idle 復帰
URL=http://localhost:4176/ node test/jptest.mjs      # 円盤→JPチャレンジ連鎖
URL=http://localhost:4176/ node test/richtest.mjs    # 確率分布・FEVER 検証（2万回サンプル）
```

> ヘッドレス環境はソフトウェア GL（SwiftShader）のため実機 GPU の 10 倍以上遅く、
> 物理抽選系のテストは数分かかります（実機では数秒）。

## 使用ライブラリとライセンス

本プロジェクトのコード・画像・音はすべてこのリポジトリ内で生成したオリジナルです。
外部アセット（モデル・テクスチャ・音源・フォント）は使用していません。

| ライブラリ | 用途 | ライセンス |
| --- | --- | --- |
| [three.js](https://threejs.org/) | 3D 描画 | MIT |
| [@dimforge/rapier3d-compat](https://rapier.rs/) | 物理エンジン | Apache-2.0 |
| [postprocessing](https://github.com/pmndrs/postprocessing) | ポストエフェクト | Zlib |
| [n8ao](https://github.com/N8python/n8ao) | アンビエントオクルージョン | ISC |
| vite / TypeScript / Playwright | ビルド・型・E2E（開発時のみ） | MIT / Apache-2.0 |
