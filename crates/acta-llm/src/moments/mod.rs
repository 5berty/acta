//! `ImportantMomentDetector` (WP3): normaliza (minúsculas, NFD sin diacríticos)
//! y busca las palabras clave de `Settings.screen.keywords` como palabra
//! completa o prefijo ("apuntad" → "apuntadlo"). Antirrebote: misma palabra
//! no dispara más de una vez cada 20 s.
