-- Uso de cada reunión, para sugerir el borrado de las antiguas que ya no se
-- usan. `cleanup_keep` = el usuario pulsó «Mantener»: no se vuelve a sugerir.
ALTER TABLE meetings ADD COLUMN last_opened_at INTEGER;
ALTER TABLE meetings ADD COLUMN last_used_at INTEGER;
ALTER TABLE meetings ADD COLUMN cleanup_keep INTEGER NOT NULL DEFAULT 0;
