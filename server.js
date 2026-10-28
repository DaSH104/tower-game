// =====================================================
// server.js  ―  ゲームのバックエンド(サーバー側)
// 役割:
//   1. public フォルダの中身(HTML/CSS/JS)をブラウザに配る
//   2. ランキング取得API  GET  /api/ranking
//   3. スコア登録API      POST /api/scores
//   4. データは Neon(Postgres)に保存する
// ※ コメントを足しただけで、動作は元のコードと同じ
// =====================================================

// ---------- 部品の読み込み ----------
// require("名前") は、npm でインストールした部品を使えるようにする命令
const express = require("express");              // Webサーバーを簡単に作る部品
const rateLimit = require("express-rate-limit"); // 「短時間にアクセスしすぎ」を止める部品
const { Pool } = require("pg");                  // Postgres(Neon)に接続する部品
// ↑ { Pool } は「pg の中から Pool だけ取り出す」書き方

// ---------- サーバー本体とDB接続の準備 ----------
const app = express(); // これがサーバー本体。この app に「道(ルート)」を足していく

// DB接続の窓口を作る。接続先のURLは環境変数 DATABASE_URL から読む。
//   ・自分のPC : PowerShell で $env:DATABASE_URL="..." と設定したもの
//   ・Render   : Environment 画面に登録したもの
// URLはパスワード入りなので、コードに直接書かない(GitHub に載るため)
// Pool は「接続を使い回す仕組み」。毎回つなぎ直すより速い
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------- テーブル(表)の作成 ----------
// サーバー起動時に1回実行。すでに scores テーブルがあれば何もしない(IF NOT EXISTS)
pool
  .query(
    `CREATE TABLE IF NOT EXISTS scores (
       id SERIAL PRIMARY KEY,               -- 1,2,3... と自動で増える番号
       name TEXT NOT NULL,                  -- プレイヤー名(空は禁止)
       score INTEGER NOT NULL,              -- スコア(整数、空は禁止)
       created_at TIMESTAMPTZ DEFAULT now() -- 登録日時(自動で現在時刻が入る)
     )`
  )
  .catch(console.error); // 失敗したらログに出す(サーバーは止めない)

// ---------- 共通の設定(ミドルウェア) ----------
// app.use(...) は「どのリクエストでも先に通す処理」を登録する。上から順に実行される

// Render などは手前にプロキシ(中継)があり、そのままだと全員が同じIPに見える。
// 1 を指定すると、1段目の中継が伝えた本当のIPを使う(レート制限に必要)
app.set("trust proxy", 1);

// ブラウザが送るJSONの本文を、JSのオブジェクトに変換して req.body に入れる
app.use(express.json());

// /api/ で始まるURLだけに制限をかける。
// 1分(60,000ミリ秒)に1人あたり30回まで。超えると 429 エラーを返す
// 数字の _ は桁を読みやすくするだけで、60000 と同じ
app.use("/api/", rateLimit({ windowMs: 60_000, max: 30 }));

// public フォルダの中身をそのまま配る。
// https://〜/ にアクセスすると public/index.html が返り、
// style.css や script.js も同じ仕組みで配られる
app.use(express.static("public"));

// ---------- API① ランキング取得 ----------
// ブラウザが GET /api/ranking にアクセスしたときの処理
// async/await は「DBの返事を待つ」ための書き方
app.get("/api/ranking", async (req, res) => {
  try {
    // rows に結果の配列が入る。{ rows } は「結果から rows だけ取り出す」書き方
    const { rows } = await pool.query(`
      SELECT name, MAX(score) AS score   -- 名前と、その人の最高スコア
      FROM scores
      GROUP BY name                      -- 同じ名前を1人にまとめる(重複を消す)
      ORDER BY score DESC, MIN(id) ASC   -- スコアの高い順。同点なら先に登録した人が上
      LIMIT 20                           -- 上位20人まで
    `);
    res.json(rows); // JSONにして返す。例: [{"name":"taro","score":12}, ...]
  } catch (e) {
    // DB接続の失敗など。原因はサーバーのログに残し、ブラウザには500エラーを返す
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- API② スコア登録 ----------
// ブラウザが POST /api/scores にアクセスしたときの処理
app.post("/api/scores", async (req, res) => {
  // ブラウザから送られた { name: "...", score: 12 } から2つを取り出す
  const { name, score } = req.body;

  // --- 入力チェック ---
  // ブラウザから来る値は信用しない。ブラウザ側のチェックは誰でも回避できるため、
  // サーバー側で必ず確認する。
  // 名前:文字列であること / 空白だけでないこと / 12文字以内
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 12) {
    return res.status(400).json({ error: "invalid name" }); // 400 = 送られた内容が不正
  }
  // スコア:整数であること / 0〜200の範囲(現実的な最大値より余裕を持たせた上限)
  if (!Number.isInteger(score) || score < 0 || score > 200) {
    return res.status(400).json({ error: "invalid score" });
  }

  try {
    // $1, $2 は値の差し込み場所(プレースホルダ)。
    // 文字列をSQLに直接つなげると、悪意ある入力でDBを操作される
    // 「SQLインジェクション」が起きる。この形なら値は別扱いなので安全
    await pool.query("INSERT INTO scores (name, score) VALUES ($1, $2)", [
      name.trim(), // 前後の空白は取り除いて保存
      score,
    ]);
    res.status(201).json({ ok: true }); // 201 = 作成できた
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- サーバー起動 ----------
// PORT は番号。Render は環境変数 PORT で番号を指定してくる。
// 無ければ(自分のPCなら)3000番を使う。|| は「左が空なら右を使う」
const PORT = process.env.PORT || 3000;
// この番号でアクセスの待ち受けを始める
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));