-- Favoritas: estrella en reuniones y en grupos. Las reuniones de un grupo con
-- estrella cuentan como favoritas (filtro, búsqueda y limpieza).
ALTER TABLE meetings ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0;
CREATE INDEX meetings_favourite ON meetings(favourite) WHERE favourite = 1;
