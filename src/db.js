const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// Railway Volume mount:
// ako mountaš volume na /app/data, ovo će biti trajno.
// lokalno će isto raditi jer pravi ./data folder.
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "farm.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS plantings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      crop_key TEXT NOT NULL,
      amount INTEGER NOT NULL,
      planted_at INTEGER NOT NULL,
      harvest_at INTEGER NOT NULL,
      harvested INTEGER NOT NULL DEFAULT 0,
      harvest_message_id TEXT
    )
  `);
});

module.exports = db;
