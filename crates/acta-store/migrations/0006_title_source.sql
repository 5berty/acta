-- De dónde salió el título automático: 'app' (ventana de Teams) o
-- 'calendar' (evento del Calendario) mandan sobre el del LLM; NULL = el
-- provisional o uno del LLM. El del usuario va en `title_edited`.
ALTER TABLE meetings ADD COLUMN title_source TEXT;
