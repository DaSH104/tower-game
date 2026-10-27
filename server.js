const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const db = new Database("game.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(express.json());
const rateLimit = require("express-rate-limit");

app.set("trust proxy", 1);
app.use("/api/", rateLimit({ windowMs: 60_000, max: 30 }));

app.use(express.static("public"));

// ランキング取得
app.get("/api/ranking", (req, res) => {
  const rows = db
    .prepare(`
      SELECT name, MAX(score) AS score
      FROM scores
      GROUP BY name
      ORDER BY score DESC, MIN(id) ASC
      LIMIT 20
    `)
    .all();
  res.json(rows);
});

// スコア登録
app.post("/api/scores", (req, res) => {
  const { name, score } = req.body;

  if (typeof name !== "string" || name.trim().length === 0 || name.length > 12) {
    return res.status(400).json({ error: "invalid name" });
  }
  if (!Number.isInteger(score) || score < 0 || score > 200) {
    return res.status(400).json({ error: "invalid score" });
  }

  db.prepare("INSERT INTO scores (name, score) VALUES (?, ?)").run(name.trim(), score);
  res.status(201).json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));