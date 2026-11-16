-- Título editado por el usuario (no se pisa con el sugerido), índice sin
-- embeddings pendiente de reindexar y tramos de pantalla compartida.
ALTER TABLE meetings ADD COLUMN title_edited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN index_stale INTEGER NOT NULL DEFAULT 0;

CREATE TABLE screen_shares (
  id         INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER,
  presenter  TEXT
);
CREATE INDEX idx_screen_shares_meeting ON screen_shares(meeting_id);
