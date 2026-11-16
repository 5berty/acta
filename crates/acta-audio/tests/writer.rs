//! Especificación del SegmentWriter (WP1).

#[test]
#[ignore = "WP1: un fallo de escritura avanza el índice y vacía el buffer (bug Meetily)"]
fn failed_segment_never_reuses_name_nor_retries_in_loop() {}

#[test]
#[ignore = "WP1: crash a mitad de segmento → recovery repara el .tmp y no pierde más de flush_every_ms"]
fn recovery_repairs_tmp_segment() {}

#[test]
#[ignore = "WP1: hueco en pts_us de una pista → se rellena con silencio y ambas pistas quedan alineadas"]
fn gaps_are_padded_with_silence() {}
