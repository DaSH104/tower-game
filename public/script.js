// ====== 設定 ======
// バックエンドのURL。同一オリジンなら空文字のままでOK
const API_BASE = "";
// 想定API:
//   GET  {API_BASE}/api/ranking  -> [{ "name": "foo", "score": 12 }, ...]  (スコア降順)
//   POST {API_BASE}/api/scores   body: { "name": "foo", "score": 12 }

const { Engine, World, Bodies, Body, Composite } = Matter;

// ====== どうぶつ定義 ======
// shape: "circle" | "rect" / k: 基準サイズに対する倍率
const ANIMALS = [
  { e: "🐭", shape: "circle", k: 0.8 },
  { e: "🐱", shape: "circle", k: 1.0 },
  { e: "🐶", shape: "circle", k: 1.1 },
  { e: "🐷", shape: "circle", k: 1.2 },
  { e: "🐸", shape: "circle", k: 1.0 },
  { e: "🐰", shape: "rect",   k: 1.1 },
  { e: "🐼", shape: "circle", k: 1.3 },
  { e: "🐢", shape: "rect",   k: 1.2 },
  { e: "🦒", shape: "rect",   k: 1.5 },
  { e: "🐘", shape: "rect",   k: 1.6 },
];

// ====== DOM ======
const $ = (id) => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");
const scoreEl = $("score");

// ====== 状態 ======
let engine, W, H, unit, platform;
let bodies = [];          // {body, animal, size}
let current = null;       // 操作中のどうぶつ {animal, size, x, angle}
let dragging = false;
let score = 0;
let playing = false;
let cooldown = false;
let playerName = localStorage.getItem("tower_name") || "";
let rafId = null;

// ====== 初期化 ======
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  unit = W / 9;
}

function setupWorld() {
  engine = Engine.create();
  engine.gravity.y = 1.1;
  bodies = [];
  platform = Bodies.rectangle(W / 2, H - 40, W * 0.42, 24, {
    isStatic: true,
    friction: 1,
  });
  World.add(engine.world, platform);
}

function randomAnimal() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return { animal: a, size: unit * a.k, x: W / 2, angle: 0 };
}

function spawnNext() {
  current = randomAnimal();
  cooldown = false;
}

function startGame() {
  resize();
  setupWorld();
  score = 0;
  scoreEl.textContent = 0;
  playing = true;
  $("rotate-btn").classList.remove("hidden");
  $("player-name").textContent = playerName;
  spawnNext();
  cancelAnimationFrame(rafId);
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(t - last, 33);
    last = t;
    if (playing) Engine.update(engine, dt);
    checkGameOver();
    draw();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

// ====== 操作 ======
function pointerX(e) {
  const rect = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(W, e.clientX - rect.left));
}

canvas.addEventListener("pointerdown", (e) => {
  if (!playing || !current || cooldown) return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  current.x = pointerX(e);
});
canvas.addEventListener("pointermove", (e) => {
  if (dragging && current) current.x = pointerX(e);
});
canvas.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = false;
  drop();
});
canvas.addEventListener("pointercancel", () => { dragging = false; });

$("rotate-btn").addEventListener("click", () => {
  if (current && !cooldown) current.angle += Math.PI / 4;
});

function drop() {
  if (!playing || !current || cooldown) return;
  const { animal, size, x, angle } = current;
  const y = 40;
  const opts = { friction: 0.8, restitution: 0.05, density: 0.002, angle };
  const body = animal.shape === "circle"
    ? Bodies.circle(x, y, size * 0.45, opts)
    : Bodies.rectangle(x, y, size * 0.85, size * 0.85, opts);
  World.add(engine.world, body);
  bodies.push({ body, animal, size });
  current = null;
  cooldown = true;

  // 少し待ってスコア加算＆次のどうぶつ
  setTimeout(() => {
    if (!playing) return;
    score++;
    scoreEl.textContent = score;
    spawnNext();
  }, 900);
}

// ====== 判定 ======
function checkGameOver() {
  if (!playing) return;
  for (const b of bodies) {
    if (b.body.position.y > H + 60) {
      endGame();
      return;
    }
  }
}

async function endGame() {
  playing = false;
  current = null;
  $("rotate-btn").classList.add("hidden");
  $("final-score").textContent = score;
  $("submit-status").textContent = "スコア送信中...";
  $("gameover-screen").classList.remove("hidden");
  try {
    await postScore(playerName, score);
    $("submit-status").textContent = "スコアを登録したよ";
  } catch (err) {
    console.error(err);
    $("submit-status").textContent = "送信に失敗しました";
  }
}

// ====== 描画 ======
function draw() {
  ctx.clearRect(0, 0, W, H);

  // 台
  if (platform) {
    const v = platform.vertices;
    ctx.fillStyle = "#8b6b4a";
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.fill();
  }

  // 積まれたどうぶつ
  for (const b of bodies) drawEmoji(b.animal.e, b.body.position.x, b.body.position.y, b.size, b.body.angle);

  // 操作中のどうぶつ
  if (current) {
    drawEmoji(current.animal.e, current.x, 40, current.size, current.angle);
    // 落下位置ガイド
    ctx.strokeStyle = "rgba(0,0,0,.15)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(current.x, 40 + current.size / 2);
    ctx.lineTo(current.x, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawEmoji(emoji, x, y, size, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `${size}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 0, size * 0.05);
  ctx.restore();
}

// ====== API ======
async function postScore(name, score) {
  const res = await fetch(`${API_BASE}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, score }),
  });
  if (!res.ok) throw new Error(`POST failed: ${res.status}`);
}

async function fetchRanking() {
  const res = await fetch(`${API_BASE}/api/ranking`);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
}

async function showRanking() {
  const list = $("ranking-list");
  list.innerHTML = "<li>読み込み中...</li>";
  $("ranking-screen").classList.remove("hidden");
  try {
    const data = await fetchRanking();
    list.innerHTML = "";
    if (!data.length) {
      list.innerHTML = "<li>まだ記録がありません</li>";
      return;
    }
    for (const r of data.slice(0, 20)) {
      const li = document.createElement("li");
      const n = document.createElement("span");
      const s = document.createElement("span");
      n.className = "n";
      s.className = "s";
      n.textContent = r.name;   // textContentでXSS回避
      s.textContent = r.score;
      li.append(n, s);
      list.appendChild(li);
    }
  } catch (err) {
    console.error(err);
    list.innerHTML = "<li>取得に失敗しました</li>";
  }
}

// ====== UIイベント ======
$("name-input").value = playerName;

$("start-btn").addEventListener("click", () => {
  const name = $("name-input").value.trim();
  if (!name) {
    $("name-input").focus();
    return;
  }
  playerName = name;
  localStorage.setItem("tower_name", name);
  $("start-screen").classList.add("hidden");
  startGame();
});

$("retry-btn").addEventListener("click", () => {
  $("gameover-screen").classList.add("hidden");
  startGame();
});
$("title-btn").addEventListener("click", () => {
  $("gameover-screen").classList.add("hidden");
  $("start-screen").classList.remove("hidden");
});
$("ranking-btn").addEventListener("click", showRanking);
$("ranking-btn2").addEventListener("click", showRanking);
$("ranking-close").addEventListener("click", () => $("ranking-screen").classList.add("hidden"));

window.addEventListener("resize", () => { if (!playing) resize(); });
resize();
