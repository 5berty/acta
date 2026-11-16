-- acta — esquema inicial (migración 1). Dueño: WP2.
-- Convenciones: ids TEXT (UUID v7), tiempos de pared *_at = INTEGER unix ms,
-- tiempos de audio *_ms = INTEGER ms en la línea media (sin pausas).
-- Las migraciones se aplican con PRAGMA user_version (ver db/mod.rs).

PRAGMA foreign_keys = ON;

CREATE TABLE meetings (
  rowid_alias   INTEGER PRIMARY KEY,               -- rowid estable para vec_meetings
  id            TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  platform      TEXT NOT NULL,                     -- teams|meet|zoom|slack|other
  app_bundle_id TEXT,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,                     -- recording|processing|ready|failed
  recovered     INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  language      TEXT NOT NULL DEFAULT 'es',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX meetings_started_at ON meetings(started_at DESC);

CREATE TABLE voiceprints (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  embedding    BLOB NOT NULL,                      -- f32 little-endian
  model        TEXT NOT NULL,
  dims         INTEGER NOT NULL,
  samples      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE speakers (
  id                TEXT PRIMARY KEY,
  meeting_id        TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,                 -- "Yo", "Speaker 1"
  display_name      TEXT,
  is_me             INTEGER NOT NULL DEFAULT 0,
  track             TEXT NOT NULL,                 -- mic|system
  diarization_label TEXT,
  name_source       TEXT NOT NULL,                 -- me|user|appUi|voiceprint|generic
  confirmed         INTEGER NOT NULL DEFAULT 0,
  voiceprint_id     TEXT REFERENCES voiceprints(id) ON DELETE SET NULL
);
CREATE INDEX speakers_meeting ON speakers(meeting_id);

CREATE TABLE utterances (
  id         INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  speaker_id TEXT NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  track      TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  text       TEXT NOT NULL,
  confidence REAL,
  UNIQUE (meeting_id, idx)
);

-- FTS5 sobre utterances (contenido externo). Sin acentos para que "reunion" encuentre "reunión".
CREATE VIRTUAL TABLE utterances_fts USING fts5(
  text, content='utterances', content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER utterances_ai AFTER INSERT ON utterances BEGIN
  INSERT INTO utterances_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER utterances_ad AFTER DELETE ON utterances BEGIN
  INSERT INTO utterances_fts(utterances_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER utterances_au AFTER UPDATE ON utterances BEGIN
  INSERT INTO utterances_fts(utterances_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO utterances_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE minutes (
  meeting_id   TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  summary_md   TEXT NOT NULL,
  escaleta     TEXT NOT NULL,                      -- JSON {temas:[...]}
  key_moments  TEXT NOT NULL DEFAULT '[]',         -- JSON [KeyMoment]
  provider     TEXT NOT NULL,
  model        TEXT,
  generated_at INTEGER NOT NULL
);

CREATE TABLE decisions (
  id         TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  at_ms      INTEGER
);
CREATE INDEX decisions_meeting ON decisions(meeting_id);

CREATE TABLE action_items (
  id               TEXT PRIMARY KEY,
  meeting_id       TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text             TEXT NOT NULL,
  owner_name       TEXT,
  owner_speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL,
  is_mine          INTEGER NOT NULL DEFAULT 0,
  due              TEXT,
  done             INTEGER NOT NULL DEFAULT 0,
  at_ms            INTEGER
);
CREATE INDEX action_items_meeting ON action_items(meeting_id);
CREATE INDEX action_items_mine_open ON action_items(is_mine, done);

CREATE TABLE captures (
  id         TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  at_ms      INTEGER NOT NULL,
  at_wall    INTEGER NOT NULL,
  path       TEXT NOT NULL,                        -- relativa a meetings/<id>/
  reason     TEXT NOT NULL,                        -- slideChange|keyword|llmPick|manual|candidate
  phash      TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  keyword    TEXT,
  topic_path TEXT                                  -- "2" / "2.1" en la escaleta
);
CREATE INDEX captures_meeting ON captures(meeting_id, at_ms);

CREATE TABLE capture_action_items (
  capture_id     TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  action_item_id TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  PRIMARY KEY (capture_id, action_item_id)
);

CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  kind        TEXT NOT NULL,                       -- manual|suggested
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE group_meetings (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (group_id, meeting_id)
);

CREATE TABLE group_suggestions (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  description TEXT,
  meeting_ids TEXT NOT NULL,                       -- JSON [MeetingId]
  cohesion    REAL NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Chunks para RAG (ventanas de utterances).
CREATE TABLE chunks (
  id         INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  text       TEXT NOT NULL
);
CREATE INDEX chunks_meeting ON chunks(meeting_id);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, content='chunks', content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

-- Vectores (sqlite-vec). 384 dims = multilingual-e5-small. Cambiar de modelo
-- = migración nueva que recrea estas tablas y reindexa.
CREATE VIRTUAL TABLE vec_chunks USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[384] distance_metric=cosine
);
CREATE VIRTUAL TABLE vec_meetings USING vec0(
  meeting_rowid INTEGER PRIMARY KEY,
  embedding float[384] distance_metric=cosine
);

CREATE TABLE embedding_meta (
  key   TEXT PRIMARY KEY,                          -- 'model', 'dims'
  value TEXT NOT NULL
);

CREATE TABLE chat_threads (
  id         TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,                        -- meeting|group|all
  scope_id   TEXT,
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chat_messages (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,                        -- user|assistant
  content    TEXT NOT NULL,
  citations  TEXT NOT NULL DEFAULT '[]',           -- JSON [Citation]
  provider   TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_messages_thread ON chat_messages(thread_id, created_at);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,                          -- 'app' → JSON Settings
  value TEXT NOT NULL
);

-- Auditoría de llamadas LLM (depuración; sin contenido del transcript).
CREATE TABLE llm_runs (
  id          INTEGER PRIMARY KEY,
  meeting_id  TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                       -- minutes|chat|group_name
  provider    TEXT NOT NULL,
  model       TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  ok          INTEGER,
  error       TEXT
);
