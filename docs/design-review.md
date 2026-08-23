# GOLD RUSH — 画づくり・UI デザインレビューと改善指示

作成: 2026-08-20 / 対象: `src/render/`, `src/camera/`, `src/ui/`

このドキュメントは「実装をどう直すか」まで踏み込んだ指示書です。上ほど効果が大きい順。
**A（最優先）の 3 項目だけで、スクリーンショットの印象は別物になります。**

---

## 0. 全体診断 — なぜ「3D のプレビュー」に見えるのか

まず前提として、レンダリングパイプラインはきちんと組まれています。

- `RendererFactory` … sRGB 出力、ACES トーンマップ
- `PostFX` … N8AO（AO）→ Bloom（0.85 / threshold 0.78）→ SMAA(Ultra) → ACES → Vignette(0.62)
- `Lighting` … 影付き key + 青 rim + hemi fill + ambient
- `MedalMaterial` … `color 0xffc64a / metalness 1.0 / roughness 0.32 / roughnessMap` = 正しい金属設定

**つまり「エフェクトが足りない」のではありません。** 素人っぽく見える原因は次の 3 つです。

| # | 症状 | 根本原因 |
|---|---|---|
| 1 | 筐体が小さく、画面の上下 3 割以上が真っ黒 | `CameraRig.PLAY` が遠すぎ・画角が広すぎ |
| 2 | メダルが金色に見えず灰色プラスチックに見える | **HDRI が存在せず `RoomEnvironment` にフォールバックしている** |
| 3 | いちばん盛り上がる瞬間（スロットのリーチ／当たり）が読めない | `CameraRig.SLOT` / `JACKPOT` のポーズが定義済みなのに一度も使われていない |

---

## A. 最優先

### A-1. 環境マップ（IBL）を用意する — これが一番効きます

`src/render/Environment.ts` は `public/assets/hdri/studio.hdr` を探し、無ければ three.js の
`RoomEnvironment`（白いスタジオの箱）にフォールバックします。**現在このファイルは存在しません。**

メダルは `metalness: 1.0` なので、**見た目の色はほぼ 100% 環境マップの反射で決まります。**
中性グレーの箱を反射している金は、彩度の低い灰色になります。これが「メダルが安っぽい」原因です。
さらに `scene.background` は暗い青のグラデーションなのに、反射しているのは明るい白い部屋 ——
**背景と反射が矛盾している**ので、脳が「合成された CG」と判断します。

**指示（どちらかを選ぶ）:**

**案1: HDRI を置く（手軽・推奨）**
- Poly Haven などの CC0 HDRI から、暗めで色光のあるもの（`neon_photostudio`, `studio_small_09`,
  夜景系）を 1k 解像度で取得し `public/assets/hdri/studio.hdr` に置く（1〜3MB）
- ロードは既に実装済みなので、置くだけで反射が変わります

**案2: 自前の環境シーンを作る（追加ファイルなし・作品としてはこちらが強い）**
```ts
// Environment.ts — RoomEnvironment の代わりに、この筐体のための環境を組む
function buildArcadeEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const plane = (w: number, h: number, color: number, intensity: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    );
    m.material.color.multiplyScalar(intensity);
    return m;
  };
  // 上: 暖色のトップライト（メダルに縦のハイライトを作る）
  const top = plane(12, 12, 0xfff0d0, 3.0); top.rotation.x = Math.PI / 2; top.position.y = 6;
  // 左右: シアンとマゼンタ（筐体のネオンと同じ色を反射に混ぜる）
  const left = plane(10, 8, 0x18e0ff, 1.4); left.rotation.y = Math.PI / 2; left.position.x = -6;
  const right = plane(10, 8, 0xff48c0, 1.2); right.rotation.y = -Math.PI / 2; right.position.x = 6;
  // 背面: 暗い床面（下からの反射を抑える）
  const back = plane(12, 8, 0x0a0d18, 1.0); back.position.z = -6;
  env.add(top, left, right, back);
  return env;
}
```
`pmrem.fromScene(buildArcadeEnvironment(), 0.02)` に差し替える。
**メダルに暖色のハイライトと、縁にシアン／マゼンタの色乗りが出て、一気に「メダルゲーム」になります。**

補足: 環境の明るさが上がると全体が明るくなりすぎるので、`ambient.intensity` を
`0.12 → 0.06`、`fill.intensity` を `0.6 → 0.4` に落として調整してください。

### A-2. カメラを寄せる

```ts
// 現在 (CameraRig.ts)
static readonly PLAY: CameraPose = {
  position: new THREE.Vector3(0, 6.4, 14.2),   // 14.2 は遠い
  target:   new THREE.Vector3(0, 1.35, -1.5),
  fov: 56,                                      // 広角
};
```

コメントに「playfield と背面上部のモニタの**両方**を収める固定視点」とあり、
その制約のせいで引きの絵になっています。結果、筐体が画面高の 6 割弱、上下に大きな黒帯。

**指示:**

1. まず `PLAY` を寄せる。目安 —
   ```ts
   position: new THREE.Vector3(0, 5.2, 10.4),
   target:   new THREE.Vector3(0, 1.6, -1.2),
   fov: 44,                     // 画角を狭めるとパース歪みが減り「製品写真」らしくなる
   ```
   fov を下げると同じ画角に収めるのに距離が必要ですが、**望遠寄りのほうが高級に見えます**
2. モニタが切れるなら、**モニタを下げる／手前に傾ける**ほうが正しい解決です
   （筐体側のレイアウトを直す）。カメラを引いて両方入れるのは、両方とも小さくなるだけです
3. わずかに煽る（カメラを下げる）と筐体が大きく見えます。`y: 6.4 → 5.2` はその意図
4. `BONUS`（別の固定視点）も同様に寄せる

### A-3. スロットの見せ場でカメラを動かす

`CameraRig.SLOT`（fov 38 の寄り）と `CameraRig.JACKPOT` が**定義済みなのに未使用**です
（使われているのは PLAY / BONUS / DISC / JPDROP のみ）。

現状、リーチ・当たりが筐体内の小さなパネルで起きて終わります。**ゲームでいちばん気持ちいい
瞬間が、画面でいちばん小さい要素**という状態です。

**指示:**

1. `SlotMachine` がリーチに入ったら `camera.setPose(CameraRig.SLOT)`、確定後 1.5 秒で
   `PLAY` に戻す（`GameStateMachine` に既にある `setPose` の呼び方をそのまま使う）
2. 当たりの瞬間に `postFX.pulseBloom(0.6)`（実装済み）と `shake` を入れる
3. さらに、リーチ／当たりは **DOM オーバーレイにも出す**。`hud-overlay`（`overlay-title` /
   `overlay-sub`）が既にあるので、`リーチ!!` `7 7 7 — JACKPOT` を画面中央に大きく出す。
   3D の中の小さい文字を読ませようとしない

---

## B. 画づくりの詰め

### B-1. 筐体が宙に浮いている

背景は `makeGradientBackground()` の縦グラデーションのみで、**床がありません。**
影は落ちていますが受け手がないので、筐体が空中に置かれて見えます。

**指示:**
- `y = LAYOUT.groundY` に暗い床（`MeshStandardMaterial { color: 0x05070f, roughness: 0.35,
  metalness: 0.0 }`）を敷く。反射させたいなら `MeshStandardMaterial` の `roughness 0.15` 程度で
  環境が薄く映る程度にする（`Reflector` は重いので不要）
- 床に**筐体の真下だけ明るい光だまり**（半径 6 程度の放射グラデーションのテクスチャ）を置くと、
  「アーケードの暗いフロアにこの筐体だけスポットが当たっている」画になります
- ビネット（`darkness 0.62`）は既に効いているので、床を足すとちょうど良く締まります

### B-2. ライティングの色設計

```ts
key    = DirectionalLight(0xffffff, 2.4)  // 真っ白
rim    = DirectionalLight(0x4d7bff, 1.1)  // 青
fill   = HemisphereLight(0xbfd4ff, 0x141018, 0.6)
ambient= AmbientLight(0xffffff, 0.12)
```

キーが純白、フィルも青系なので、**画面全体が青一色**になっています。筐体のネオンは
シアン・マゼンタ・ゴールドの 3 色なのに、ライティングがそれを支えていません。

**指示:**
- `key` を **暖色**に: `0xfff2e0`、強度 2.4 → 2.0。青いリムとの色対比が生まれます
- `rim` はそのまま青（`0x4d7bff`）で残し、**反対側にマゼンタのリムを 1 灯追加**
  （`0xff48c0`, intensity 0.7, position (6, 3, -5)）。筐体のネオンと画面全体が繋がります
- 筐体上部のマーキーから**コイン面に向かう SpotLight** を 1 灯足す
  （`angle 0.5, penumbra 0.6, intensity 2.5, 暖色`）。プレイエリアが画面内で一番明るくなり、
  視線が自然にそこへ行きます。今は key が全体を均一に照らしているだけで、主役の指定がありません
- `ambient` は環境マップを強くしたら `0.06` まで落とす

### B-2 補足: トーンマップの二重適用は既に対策済み

`PostFX` が `renderer.toneMapping = NoToneMapping` にして `ToneMappingEffect` 側で
ACES を掛ける形になっており、正しいです。ここは触らないでください。

### B-3. 主従が逆転している

左の「JP CHALLENGE」の大きな円盤が、主役であるプッシャー筐体より視覚的に重い
（面積が大きく、外周が黄色く光っている）。

**指示:** 円盤を筐体の**後ろ・上**に移すか、一回り小さくする。少なくとも常時発光は止め、
JP チャレンジ中だけ光らせる。右の JP 台も同様。**待機中は主役 1 つだけが光っている状態**にする。

---

## C. HUD — 色と書体

### C-1. 現状

`hud.css` は `.panel` を共通クラスにしていて設計は正しいです。問題は**上書きの仕方**。

| パネル | 数字サイズ | 色 | 装飾 |
|---|---|---|---|
| CREDITS | 30px | `--gold` + text-shadow | 経験値バー |
| JACKPOT | **38px** | 白→金→ピンクのグラデ文字 + 常時 pulse アニメ | `★ JACKPOT ★` |
| MEDALS | **22px** | 白 | シアン→金のグラデバー |

3 枚が別々のデザイン言語で喋っています。特に **`★ JACKPOT ★` の星と、常時点滅する
グラデーション文字**が、いちばん「フリー素材のゲーム」っぽく見える箇所です。

### C-2. 指示

1. **数字のサイズを 2 段階に固定**する。主 = 34px、従 = 20px。
   CREDITS 34 / JACKPOT 34 / MEDALS 34（`/500` だけ 14px）に揃える。
   ジャックポットを大きくしたいなら、**サイズではなく色と枠**で差を付ける
2. `★` を削除。ラベルは全部 `CREDITS` `JACKPOT` `MEDALS` の等幅英字で、
   `font-size: 11px / letter-spacing: 2px / uppercase / opacity .6` に統一（既存の `.stat-label` のまま）
3. **グラデーション文字をやめる**。`color: var(--gold)` の単色 + `text-shadow` の発光だけにする。
   グラデ文字は縮小時に汚くなり、`background-clip: text` は環境差も出ます
4. **常時 pulse をやめる**。`jp-pulse` は「ジャックポットが実際に増えたとき」だけ 1 回再生する
   （常時点滅は情報がないのに視線を奪い続けます）
5. 色の役割を決める:
   ```
   --gold  #ffcf4a … 所持クレジット・当たり・報酬。プレイヤーの「得」
   --cyan  #18e0ff … システム側の状態（メダル残量・進捗バー）
   マゼンタ #ff48c0 … ジャックポット関連のみ
   ```
   現在 `.medal-bar` が「シアン→金」のグラデで、満タンで「金→赤」に変わります。
   意味が 3 回変わるので、**シアン単色にして満タン時だけ金**にする
6. **角丸をスケール化**する。現在 `panel: 14px` / `btn: 12px` / `medal-bar: 3px` / `exp-bar: ?` と
   バラバラ。`--r-lg: 14px` / `--r-md: 10px` / `--r-sm: 4px` を定義して 3 段階に揃える

### C-3. 書体 — webfont を 1 つ入れる

```css
/* 現在 */
font-family: 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', system-ui, sans-serif;
```

webfont を読んでいないので、**環境ごとに別のゲームに見えます**（Windows は Segoe UI、
Mac はヒラギノ）。アーケード機の HUD としては、どちらも「OS の UI フォント」で個性がありません。

**指示:**

```html
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=Noto+Sans+JP:wght@500;700&display=swap" rel="stylesheet" />
```
```css
:root {
  --font-display: 'Chakra Petch', 'Noto Sans JP', system-ui, sans-serif;  /* 数字・英字ラベル */
  --font-ui:      'Noto Sans JP', system-ui, sans-serif;                   /* 和文 */
  font-family: var(--font-ui);
}
.stat-value, .stat-label { font-family: var(--font-display); }
```

- `Chakra Petch`（角ばった幾何学サンセリフ）はメダルゲーム／アーケードの空気に合い、
  数字が縦に揃います。`Saira Condensed` `Bai Jamjuree` も同系統
- **`Orbitron` は避ける**（SF ゲームで使われすぎていて、かえって素人っぽく見えます）
- 和文に `letter-spacing: 1px`（`.btn`）が掛かっています。**和文には字間を掛けない**。
  `.btn` を英字用と和文用で分けるか、`letter-spacing: 0.02em` 程度に落とす

### C-4. 操作説明を出しっぱなしにしない

`.hint`（「クリック / スペースでメダル投入 ・ ホールドで連続投入」）が常時表示です。

**指示:** 初回入力から 3 秒後にフェードアウトし、以後は表示しない（`localStorage` に記録）。
`視点切替` の隣に `?` ボタンを置いて、押したら再表示する。

### C-5. ボタン

`メダル投入` `視点切替` `🔊` の 3 つ。`🔊` だけ絵文字でサイズも役割も違います。

**指示:** 音量はアイコンボタン（線画 SVG）にして、他 2 つのテキストボタンとは
明確に別の見た目（正方形・枠だけ）にする。今は「同じ形の中に絵文字が 1 つだけ」で浮いています。

---

## D. 優先順位と見積り

| 優先 | 項目 | 効果 | 目安 |
|---|---|---|---|
| ★★★ | A-1 環境マップ（HDRI か自前 env） | メダルが金属に見える。最大の変化 | 1〜3h |
| ★★★ | A-2 カメラを寄せる（fov 44 / z 10.4） | 主役が画面を占める | 30分（調整含め 1h） |
| ★★★ | A-3 スロット時のカメラ寄り + DOM オーバーレイ | 見せ場が伝わる | 2〜3h |
| ★★☆ | B-1 床と光だまり | 接地して「置かれている」画になる | 1〜2h |
| ★★☆ | B-2 キーを暖色に・マゼンタリム・スポット追加 | 画面の色に立体感 | 1h |
| ★★☆ | C-2 HUD の統一（★削除・グラデ文字廃止・サイズ 2 段） | 仕上がり感 | 1〜2h |
| ★☆☆ | C-3 webfont 導入 | 個性と安定 | 30分 |
| ★☆☆ | B-3 主従の整理（円盤を控えめに） | 視線誘導 | 1〜2h |
| ★☆☆ | C-4 / C-5 ヒントとボタン | 細部 | 1h |

**ポートフォリオ用の録画は A-1 / A-2 の後に撮り直すと効果が最大です。**
（`portfolio-site` の `/portfolio-update gold-rush` で再録画・差し替えができます）
