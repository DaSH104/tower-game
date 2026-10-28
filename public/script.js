// =====================================================
// script.js ― ゲーム本体(ブラウザで動く)
// 担当: 物理演算 / 描画 / タッチ操作 / ゲームオーバー判定 / サーバーとの通信
// ※ コメントを足しただけで、動作は元のコードと同じ
// =====================================================

// ====== 設定 ======
// バックエンドのURL。
// このゲームは server.js が HTML も配るので、同じ場所(同一オリジン)にAPIがある。
// そのため空文字 "" でよい。別のサーバーに分けたら、ここに "https://〜" を入れる
const API_BASE = "";
// 想定API:
//   GET  {API_BASE}/api/ranking  -> [{ "name": "foo", "score": 12 }, ...]  (スコア降順)
//   POST {API_BASE}/api/scores   body: { "name": "foo", "score": 12 }

// Matter.js(物理エンジン)から使う部品を取り出す。
//   Engine : 物理計算を進める本体
//   World  : 物体を入れる世界(add で追加)
//   Bodies : 円や四角の物体を作る
//   Body, Composite : このコードでは使っていない(なくても動く)
const { Engine, World, Bodies, Body, Composite } = Matter;

// ====== どうぶつ定義 ======
// e: 絵文字 / shape: 物理上の形("circle" 円、"rect" 四角) / k: 大きさの倍率
// 倍率が大きいほど大きい(ネズミ0.8、ゾウ1.6)。
// 見た目は絵文字だが、当たり判定は円か四角で近似している
const ANIMALS = [
  { e: "🐭", shape: "circle", k: 0.8 },
  { e: "🐱", shape: "rect", k: 1.0 },
  { e: "🐶", shape: "rect", k: 1.1 },
  { e: "🐷", shape: "circle", k: 1.2 },
  { e: "🐸", shape: "circle", k: 1.0 },
  { e: "🐰", shape: "rect",   k: 1.1 },
  { e: "🐼", shape: "circle", k: 1.3 },
  { e: "🐢", shape: "rect",   k: 1.2 },
  { e: "🦒", shape: "rect",   k: 1.5 },
  { e: "🐘", shape: "rect",   k: 1.6 },
];

// ====== DOM(画面の部品)の取得 ======
// $("score") は document.getElementById("score") の短縮形。
// HTML の id から、操作したい要素を取ってくる
const $ = (id) => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d"); // ctx = canvas に絵を描く「筆」
const scoreEl = $("score");

// ====== 状態(ゲーム中に変わる値) ======
// let は後から値を変えられる変数
let engine, W, H, unit, platform;
//   engine   : 物理エンジン
//   W, H     : canvas の幅と高さ(画面サイズ)
//   unit     : 基準サイズ(画面幅の1/9)。どうぶつの大きさの元になる
//   platform : どうぶつを乗せる台
let bodies = [];          // 落としたどうぶつの一覧 {body: 物理の体, animal: 種類, size: 大きさ}
let current = null;       // いま指で操作している(まだ落としていない)どうぶつ
let dragging = false;     // 指で押している最中か
let score = 0;            // 積んだ数
let playing = false;      // ゲーム中か
let cooldown = false;     // 落とした直後の待ち時間中か(連続で落とせないように)
// 前回入力した名前をブラウザに保存してあれば読み込む(次回から入力を省ける)
let playerName = localStorage.getItem("tower_name") || "";
let rafId = null;         // アニメーションのループを止めるための番号

// ====== 初期化 ======

// 画面サイズに合わせて canvas の大きさを決める
function resize() {
  // dpr = 画面の細かさ(スマホは2〜3が多い)。
  // これを考慮しないと、スマホで絵がぼやける
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect(); // CSSで決まった実際の表示サイズ
  W = rect.width;
  H = rect.height;
  // canvas の内部の解像度は dpr 倍にして、見た目の大きさ(CSS)は変えない
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  // 描く座標は「CSSのサイズ基準」のままにするための拡大指定
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  unit = W / 9; // どうぶつの基準サイズ。画面が小さくても大きさの比率が変わらない
}

// 物理の世界(重力と台)を作り直す。ゲーム開始のたびに呼ばれる
function setupWorld() {
  engine = Engine.create();
  engine.gravity.y = 0.8; // 重力の強さ(1.0が標準。大きいほど速く落ちる)
  bodies = [];
  // 台:rectangle(中心x, 中心y, 幅, 高さ, 設定)
  // 画面の左右中央、下から40pxの位置。幅は画面の42%
  platform = Bodies.rectangle(W / 2, H - 40, W * 0.70, 24, {
    isStatic: true, // 動かない物体(重力で落ちない)
    friction: 1,    // 摩擦(1 = よく滑らない)
  });
  World.add(engine.world, platform); // 世界に台を追加
}

// 次に出すどうぶつをランダムに1つ決める
function randomAnimal() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  // x は画面の中央から開始。angle は回転角(ラジアン。0 = まっすぐ)
  return { animal: a, size: unit * a.k, x: W / 2, angle: 0 };
}

// 次のどうぶつを出す
function spawnNext() {
  current = randomAnimal();
  cooldown = false; // 操作できる状態に戻す
}

// ゲーム開始(「スタート」「もう一回」を押した時)
function startGame() {
  resize();
  setupWorld();
  score = 0;
  scoreEl.textContent = 0;
  playing = true;
  $("rotate-btn").classList.remove("hidden"); // 回転ボタンを表示
  $("player-name").textContent = playerName;  // 上部にプレイヤー名を表示
  spawnNext();

  // 前のゲームのループが残っていたら止める(二重に動くのを防ぐ)
  cancelAnimationFrame(rafId);

  // ゲームのメインループ。1秒に約60回、「計算 → 判定 → 描画」を繰り返す
  let last = performance.now(); // 前回の時刻
  const loop = (t) => {
    // 前回からの経過時間(ミリ秒)。33msで頭打ちにして、
    // タブを切り替えて戻った時などに物理が一気に進んで物体が飛ぶのを防ぐ
    const dt = Math.min(t - last, 33);
    last = t;
    if (playing) Engine.update(engine, dt); // 物理を dt ミリ秒ぶん進める
    checkGameOver();                        // 落ちた物体がないか確認
    draw();                                 // 画面に描く
    // 「次の描画タイミングでまた loop を呼んで」とブラウザに予約する
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

// ====== 操作 ======

// 指(マウス)の位置を、canvas の中の x 座標に変換する。
// 0 〜 W の範囲に収めて、画面外にどうぶつが行かないようにする
function pointerX(e) {
  const rect = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(W, e.clientX - rect.left));
}

// pointer イベント = マウスも指も同じ書き方で扱える仕組み
// 指を置いた:位置の追従を開始
canvas.addEventListener("pointerdown", (e) => {
  if (!playing || !current || cooldown) return; // 操作できない状態なら何もしない
  dragging = true;
  // 指が canvas の外に出ても、このイベントを受け取り続ける設定
  canvas.setPointerCapture(e.pointerId);
  current.x = pointerX(e);
});
// 指を動かした:押している間だけ、どうぶつの x を指に合わせる
canvas.addEventListener("pointermove", (e) => {
  if (dragging && current) current.x = pointerX(e);
});
// 指を離した:その位置で落とす
canvas.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = false;
  drop();
});
// 電話の着信などで操作が中断された時:落とさずに終了
canvas.addEventListener("pointercancel", () => { dragging = false; });

// 回転ボタン:押すたびに45度(π/4 ラジアン)ずつ回す
$("rotate-btn").addEventListener("click", () => {
  if (current && !cooldown) current.angle += Math.PI / 4;
});

// どうぶつを落とす
function drop() {
  if (!playing || !current || cooldown) return;
  const { animal, size, x, angle } = current; // current の中身を取り出す
  const y = 40; // 落とし始める高さ(画面の上のほう)

  // 物体の性質
  //   friction    : 摩擦(滑りにくさ)
  //   restitution : 反発(0 = 跳ねない、1 = 完全に跳ね返る)
  //   density     : 密度(重さに関係)
  //   angle       : 最初の傾き(回転ボタンで決めた角度)
  const opts = { friction: 0.8, restitution: 0.05, density: 0.002, angle };

  // 形で作り分ける。円は半径、四角は縦横の長さ。
  // 当たり判定を絵文字よりやや小さくして(0.45 / 0.85)、
  // 絵文字の余白ぶんの「見えない隙間」ができにくいようにしている
  const body = animal.shape === "circle"
    ? Bodies.circle(x, y, size * 0.45, opts)
    : Bodies.rectangle(x, y, size * 0.85, size * 0.85, opts);

  World.add(engine.world, body);          // 世界に追加 → 重力で落ち始める
  bodies.push({ body, animal, size });    // 描画用に記録
  current = null;                         // 手元のどうぶつは空にする
  cooldown = true;                        // 次が出るまで操作を止める

  // 0.9秒後に、スコアを+1して次のどうぶつを出す。
  // (落として、すぐ落ちていなければ「積めた」とみなす)
  setTimeout(() => {
    if (!playing) return; // この間にゲームオーバーになっていたら何もしない
    score++;
    scoreEl.textContent = score;
    spawnNext();
  }, 900);
}

// ====== 判定 ======

// どれか1つでも画面の下(台より下)に落ちたらゲームオーバー
function checkGameOver() {
  if (!playing) return;
  for (const b of bodies) {
    // y は下に行くほど大きい。画面の高さ H より60px下まで落ちたら終了
    if (b.body.position.y > H + 60) {
      endGame();
      return;
    }
  }
}

// ゲーム終了処理(async = 中で「サーバーの返事を待つ」ため)
async function endGame() {
  playing = false;
  current = null;
  $("rotate-btn").classList.add("hidden");
  $("final-score").textContent = score;
  $("submit-status").textContent = "スコア送信中...";
  $("gameover-screen").classList.remove("hidden"); // ゲームオーバー画面を表示
  try {
    await postScore(playerName, score); // サーバーにスコアを送り、完了まで待つ
    $("submit-status").textContent = "スコアを登録したよ";
  } catch (err) {
    // 通信失敗(サーバーが起きていない、エラーなど)
    console.error(err); // 原因をブラウザのコンソール(F12)に出す
    $("submit-status").textContent = "送信に失敗しました";
  }
}

// ====== 描画 ======
// 1フレームぶんの絵を描く。毎回いったん全部消して、描き直している
function draw() {
  ctx.clearRect(0, 0, W, H); // 画面を消す

  // 台を描く(物理の台の4つの頂点を線でつないで塗る)
  if (platform) {
    const v = platform.vertices;
    ctx.fillStyle = "#8b6b4a";
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);                       // 最初の頂点へ移動
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y); // 次々に線を引く
    ctx.closePath();
    ctx.fill();
  }

  // 積まれたどうぶつを描く(物理エンジンが計算した位置と角度で)
  for (const b of bodies) drawEmoji(b.animal.e, b.body.position.x, b.body.position.y, b.size, b.body.angle);

  // 操作中のどうぶつを描く(まだ物理には入っておらず、画面の上で待機している)
  if (current) {
    drawEmoji(current.animal.e, current.x, 40, current.size, current.angle);
    // 落下位置のガイド線(点線)
    ctx.strokeStyle = "rgba(0,0,0,.15)";
    ctx.setLineDash([4, 6]);                          // 4px線、6px空白
    ctx.beginPath();
    ctx.moveTo(current.x, 40 + current.size / 2);
    ctx.lineTo(current.x, H);
    ctx.stroke();
    ctx.setLineDash([]);                              // 点線の設定を元に戻す
  }
}

// 絵文字を指定の位置・大きさ・角度で描く
function drawEmoji(emoji, x, y, size, angle) {
  ctx.save();                    // いまの設定(座標系など)を一時保存
  ctx.translate(x, y);           // 原点をどうぶつの中心に移す
  ctx.rotate(angle);             // その原点を中心に回転
  ctx.font = `${size}px serif`;  // 文字(絵文字)の大きさ
  ctx.textAlign = "center";      // 横方向を中央揃え
  ctx.textBaseline = "middle";   // 縦方向を中央揃え
  ctx.fillText(emoji, 0, size * 0.05); // 原点に描く。絵文字の見た目の中心に合わせて少し下にずらす
  ctx.restore();                 // 保存した設定に戻す(他の描画に影響しないように)
}

// ====== サーバーとの通信(API) ======

// スコアを送る
async function postScore(name, score) {
  // fetch = サーバーへリクエストを送る命令
  const res = await fetch(`${API_BASE}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // 「JSONを送ります」という宣言
    body: JSON.stringify({ name, score }),           // JSの値 → JSON文字列に変換
  });
  // res.ok は成功(200番台)かどうか。失敗なら例外を投げて、呼び出し側の catch に任せる
  if (!res.ok) throw new Error(`POST failed: ${res.status}`);
}

// ランキングを取ってくる
async function fetchRanking() {
  const res = await fetch(`${API_BASE}/api/ranking`); // method を省略すると GET
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json(); // 返ってきたJSON文字列 → JSの配列に変換
}

// ランキング画面を表示する
async function showRanking() {
  const list = $("ranking-list");
  list.innerHTML = "<li>読み込み中...</li>";      // 待っている間の表示
  $("ranking-screen").classList.remove("hidden"); // 画面をすぐ開く
  try {
    const data = await fetchRanking();
    list.innerHTML = "";                          // 「読み込み中」を消す
    if (!data.length) {
      list.innerHTML = "<li>まだ記録がありません</li>";
      return;
    }
    // 上位20件まで(サーバーも20件まで返すが、念のため)
    for (const r of data.slice(0, 20)) {
      const li = document.createElement("li");   // 行を作る
      const n = document.createElement("span");  // 名前の部分
      const s = document.createElement("span");  // スコアの部分
      n.className = "n";
      s.className = "s";
      // textContent で入れると、名前に <script> などが入っていても
      // ただの文字として表示される(悪意のあるコードが実行されない = XSS対策)。
      // innerHTML で入れるのは危険なので使わない
      n.textContent = r.name;
      s.textContent = r.score;
      li.append(n, s);
      list.appendChild(li);                      // リストに追加
    }
  } catch (err) {
    console.error(err);
    list.innerHTML = "<li>取得に失敗しました</li>";
  }
}

// ====== ボタンなどのイベント登録 ======

// 前回の名前を入力欄に入れておく
$("name-input").value = playerName;

// スタートボタン
$("start-btn").addEventListener("click", () => {
  const name = $("name-input").value.trim(); // 前後の空白を取る
  if (!name) {
    $("name-input").focus(); // 空なら入力欄にカーソルを戻して、開始しない
    return;
  }
  playerName = name;
  localStorage.setItem("tower_name", name);    // 次回のためにブラウザに保存
  $("start-screen").classList.add("hidden");   // スタート画面を隠す
  startGame();
});

// もう一回
$("retry-btn").addEventListener("click", () => {
  $("gameover-screen").classList.add("hidden");
  startGame();
});
// タイトルへ戻る
$("title-btn").addEventListener("click", () => {
  $("gameover-screen").classList.add("hidden");
  $("start-screen").classList.remove("hidden");
});
// ランキングを開く(スタート画面用、ゲームオーバー画面用の2つ)
$("ranking-btn").addEventListener("click", showRanking);
$("ranking-btn2").addEventListener("click", showRanking);
// ランキングを閉じる
$("ranking-close").addEventListener("click", () => $("ranking-screen").classList.add("hidden"));

// 画面サイズが変わった時(スマホを回した時など)に canvas を合わせ直す。
// ゲーム中に変えると物理の世界と位置がずれるため、ゲーム中でない時だけ
window.addEventListener("resize", () => { if (!playing) resize(); });

// 最初の画面サイズを決める(ページを開いた時に1回実行される)
resize();