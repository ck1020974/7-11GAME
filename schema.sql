-- ============================================================
--  資料庫結構（SQLite／Cloudflare D1 共用）。啟動時自動建立，可重複執行。
--  為了符合 Cloudflare 免費額度，每送出一組包裹只更新 game_sessions 一列。
-- ============================================================

-- 學生名單（由 CSV 匯入）
CREATE TABLE IF NOT EXISTS students (
  student_id  TEXT PRIMARY KEY,           -- 學號（文字，保留開頭的 0）
  name        TEXT NOT NULL,
  class_name  TEXT NOT NULL,
  seat_no     TEXT,
  active      INTEGER NOT NULL DEFAULT 1, -- 0 = 停用（不能登入、不列入榮譽榜）
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
) WITHOUT ROWID;

-- 每一局校內競賽
CREATE TABLE IF NOT EXISTS game_sessions (
  id              INTEGER PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,     -- 隨機字串，同時是這局的通行憑證
  student_id      TEXT NOT NULL,
  status          TEXT NOT NULL,            -- active / finished
  started_at      INTEGER NOT NULL,
  ends_at         INTEGER NOT NULL,
  finished_at     INTEGER,
  next_at         INTEGER NOT NULL,         -- 下一組可以作答的時間（開場倒數、答題後停頓）
  score           INTEGER NOT NULL DEFAULT 0,
  sets            INTEGER NOT NULL DEFAULT 0, -- 已完成組數
  items           INTEGER NOT NULL DEFAULT 0, -- 已判定格數（每組 4 格）
  correct         INTEGER NOT NULL DEFAULT 0, -- 答對格數
  streak          INTEGER NOT NULL DEFAULT 0, -- 目前連對組數
  best_streak     INTEGER NOT NULL DEFAULT 0,
  round           TEXT NOT NULL,            -- 目前這組的兩間門市（JSON，stores.json 的位置）
  mistakes        TEXT NOT NULL DEFAULT '[]', -- 答錯紀錄（JSON：[門市位置, 縣市選擇, 鄉鎮市區選擇]）
  prev_best       INTEGER,
  is_new_record   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_student ON game_sessions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_status_end ON game_sessions(status, ends_at);

-- 每位學生的最佳成績（榮譽榜用；同分時保留較早的那一局）
CREATE TABLE IF NOT EXISTS best_scores (
  student_id    TEXT PRIMARY KEY,
  score         INTEGER NOT NULL,
  accuracy      INTEGER NOT NULL,           -- 0–100
  sets          INTEGER NOT NULL,
  best_streak   INTEGER NOT NULL,
  finished_at   INTEGER NOT NULL
) WITHOUT ROWID;
