const express = require("express");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// テーブルがなければ作る
pool
  .query(
    `CREATE TABLE IF NOT EXISTS scores (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       score INTEGER NOT NULL,
       created_at TIMESTAMPTZ DEFAULT now()
     )`
  )
  .catch(console.error);

app.set("trust proxy", 1); // デプロイ先のプロキシ越しでも正しいIPを取る
app.use(express.json());
app.use("/api/", rateLimit({ windowMs: 60_000, max: 30 }));
app.use(express.static("public"));

// ランキング取得(名前ごとの最高スコア、上位20人)
app.get("/api/ranking", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT name, MAX(score) AS score
      FROM scores
      GROUP BY name
      ORDER BY score DESC, MIN(id) ASC
      LIMIT 20
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// スコア登録
app.post("/api/scores", async (req, res) => {
  const { name, score } = req.body;

  if (typeof name !== "string" || name.trim().length === 0 || name.length > 12) {
    return res.status(400).json({ error: "invalid name" });
  }
  if (!Number.isInteger(score) || score < 0 || score > 200) {
    return res.status(400).json({ error: "invalid score" });
  }

  try {
    await pool.query("INSERT INTO scores (name, score) VALUES ($1, $2)", [
      name.trim(),
      score,
    ]);
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));