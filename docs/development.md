# 開発メモ — GOLD RUSH

作品としての説明（概要・見どころ・技術解説）は [../README.md](../README.md) にあります。
ここは動かし方・構成・テストです。

## 動かし方

```bash
npm install
npm run dev          # → http://localhost:5173
# 本番ビルド & 確認
npm run build
npm run preview
```

## アーキテクチャ

```
src/
  core/      Engine / Loop(固定 60Hz + turbo/runSteps) / Game / EventBus(型付き) / debug(?debug API)
  render/    RendererFactory / Environment(IBL) / Lighting / PostFX(N8AO→Bloom→SMAA→Vignette)
             Floor(暗い床 + 足元の加算プール) / idleGlow(出番でない機の減光) / dieFaces(サイコロの目)
             materials/ MedalMaterial + medalTexture(洋銀・3枚一致マップ) / CabinetMaterials / canvasText
  physics/   PhysicsWorld(Rapier ラッパ) / types(衝突グループ・BodyTag)
  pusher/    PusherCabinet(筐体・台形壁・横穴) / PusherPlate(kinematic 往復 + センサ)
             MedalPool(InstancedMesh 2枚 + ボディプール、最大500枚) / MedalSpawner(初速を重力から逆算)
             MiniBallManager(ダイス排出) / DropDetector / layout.ts(全寸法・wallMount)
  camera/    CameraRig(演出ポーズ補間 + 自由オービット)
  input/     InputManager(pointer/keyboard、カメラ操作の振り分け)
  state/     GameStateMachine / GameStore(observable) / Board(すごろく盤面と配当)
             Economy(RNG・ジャックポット) / Fever / Progression
  minigames/ Sugoroku / JackpotBowl / Chinchiro / DiceTray(実物理サイコロ、すごろくとチンチロで共有)
             boardArt(盤面の描画言語) / MiniGame(共通インターフェース)
  fx/        Particles / MedalBurst / JackpotFX
  ui/        HUD(DOM) / MonitorUI(3D 画面) / monitorAnchor(モニタ面への貼り付け) / DevPanel
  audio/     AudioManager(Web Audio で全 SFX を合成)
  save/      SaveManager(localStorage・バージョン移行)
```

設計の要点:

- **物理が座標を持ち、描画は読むだけ** — Rapier のボディが唯一の真実で、three.js は毎フレーム転写するのみ。
- **メダルは InstancedMesh 2枚**（通常/発光JP）で全枚数を賄い、剛体はプール再利用。最大 500 枚が同時に転がってもドローコールは増えない。
- **抽選を仕込まない** — 抽選ボウルもチンチロもサイコロも、乱数でボールを誘導していない。物理が決めた「いつ落ちたか / どの面が上か」がそのまま結果。乱数は盤面のマス構成と JP 側（`Economy.ts`）にしかない。
- **イベント駆動** — 型付き EventBus で物理・状態・UI・音を疎結合に。
- **チューニング値は 3 ファイルに集約** — `pusher/layout.ts`（寸法・速度・`medalsPerBall`）、`state/Board.ts`（`PAYOUT_SCALE` と盤面の配当カーブ）、`state/Economy.ts`（確率・ジャックポット）。

## 検証（E2E テスト）

Playwright + headless Chromium による自動テスト。`?debug` で `window.__medal`
デバッグ API（強制遷移・状態取得）が有効になり、テストはそれを介して進行を検証します。

```bash
npx playwright install chromium     # 初回のみ
npm run build
npm run preview -- --port 4176 &
URL=http://localhost:4176/ node test/smoketest.mjs   # 起動・投入・払出・JP積立
URL=http://localhost:4176/ node test/flowtest.mjs    # すごろく遷移→idle 復帰
URL=http://localhost:4176/ node test/boardtest.mjs   # すごろく進行・GOAL→抽選ボウル→チンチロ連鎖
URL=http://localhost:4176/ node test/chintest.mjs    # チンチロ単体（賭け金0なら払い出し0）
URL=http://localhost:4176/ node test/richtest.mjs    # 出目分布・FEVER 検証（6万回サンプル）
URL=http://localhost:4176/ node test/draintest.mjs   # 横穴の排出率実測 → 払い出し率の逆算
URL=http://localhost:4176/ node test/perftest.mjs    # 500枚時のフレーム間隔・物理コスト
URL=http://localhost:4176/ node test/playtest.mjs    # 長時間の通し稼働（クレジット推移・例外検出）
```

### TURBO —— 物理テストを CPU を焼かずに回す

ヘッドレス環境はソフトウェア GL（SwiftShader）なので、**描画がボトルネックになって物理が待たされます**。
実測で「壁時計 22 秒あたりゲーム内 0.74 秒」、つまり実時間の 1/30 の速度でした。
サイコロが 3 個止まるのを見るだけで CPU を 1 コア 10 分間占有する、という状態です。

そのための逃げ道が `window.__medal.turbo(n)`（`Loop.turbo`）です。
**1 フレームあたり物理＋ロジックを n ステップ余分に進め、その間いっさい描画しません。**
シミュレーション自体は 1 ステップ = `FIXED_DT` 固定なので**結果は変わりません**——
再生速度だけが変わります。

```js
window.__medal.turbo(90);   // 実時間の ~90 倍でゲーム内時間を進める（描画なし）
window.__medal.turbo(0);    // 通常再生に戻す（スクリーンショットを撮る前に必ず戻す）
window.__medal.gameSeconds();  // 経過したゲーム内秒数
```

物理を待つテスト——`flowtest` / `boardtest` / `chintest`——はすべて turbo を内蔵済みです。
`draintest` はさらに踏み込んで、turbo ではなく同期版の `simulate()` を使い、フレームすら待ちません。
`richtest` は `Economy` の乱数を直接叩くだけ、`smoketest` は短いので、どちらも必要としません。
`perftest` / `playtest` は**実時間の挙動そのものを測る**テストなので、turbo を使ってはいけません。

長いテストを書くときの原則:

- **turbo を使う** —— `chintest` / `flowtest` / `boardtest` は turbo 導入で
  10 分超 → 十数秒になりました。`flowtest` は turbo なしではタイムアウトで落ちていて、
  それは「ゲームが壊れている」のではなく「ラスタライザが遅い」だけでした
- **ビューポートを小さく** —— turbo 中は描画しませんが、turbo が効く前の数フレームは合成コストがかかります
- **スクリーンショットの直前だけ `turbo(0)`** に戻し、1 秒ほど待ってフレームを作らせる
- **開発サーバに向けて長時間走らせない** —— ソースを編集すると HMR でページが再読み込みされ、
  `window.__medal` ごと消えてテストが落ちます（`Execution context was destroyed`）。
  Vite はプロジェクト直下を丸ごと監視しているので、テストファイルを編集しただけでも
  full-reload が飛びます。**必ず `npm run build && npm run preview` に向けて走らせてください**
- **スクリーンショットは落としてよい** —— `.catch()` で握り潰す。誰も assert していない
  画像の生成に失敗しただけでテストを赤くする意味はありません
