-- Qué proveedor y modelo fallaron en el resumen («Reintentar con…»).
ALTER TABLE meetings ADD COLUMN error_provider TEXT;
ALTER TABLE meetings ADD COLUMN error_model TEXT;
