//! Título automático de una reunión (puro). Orden: título de la reunión en
//! la ventana de Teams → evento del Calendario a esa hora (opt-in) → el que
//! sugiere el LLM al resumir. Un título editado por el usuario nunca se toca.

/// Ventanas de Teams que NO son el nombre de una reunión.
const GENERIC: [&str; 22] = [
    "microsoft teams", "teams", "chat", "calendario", "calendar", "actividad", "activity", "equipos", "teams and channels",
    "reunión", "reunion", "meeting", "llamadas", "calls", "archivos", "files", "notificaciones", "notifications",
    "reunión de teams", "reunión de meet", "grabación", "contenido compartido",
];

fn fold(s: &str) -> String {
    s.trim().to_lowercase()
}

/// ¿Es un título por defecto (el de acta o uno genérico de la app)?
pub fn is_generic_title(title: &str) -> bool {
    let t = fold(title);
    t.is_empty() || GENERIC.contains(&t.as_str()) || t.starts_with("reunión de ") || t.starts_with("huddle de ")
}

/// «Daily del equipo | Microsoft Teams» → «Daily del equipo». `None` si no
/// queda un nombre de reunión.
pub fn clean_window_title(raw: &str) -> Option<String> {
    let first = raw.split(" | ").next().unwrap_or(raw).trim();
    // «Reunión: X», «Meeting in "X"», «Reunión en "X"».
    let mut t = first.to_owned();
    for prefix in ["Reunión: ", "Meeting: ", "Reunión en ", "Meeting in ", "Meeting with ", "Reunión con "] {
        if let Some(rest) = t.strip_prefix(prefix) {
            t = rest.to_owned();
        }
    }
    let t = t.trim().trim_matches(['"', '«', '»', '“', '”']).trim().to_owned();
    // Ventanas de contenido compartido o de chat no dan el nombre.
    let low = fold(&t);
    if is_generic_title(&t) || low.starts_with("chat") || low.contains("contenido compartido") || low.contains("shared content") || t.chars().count() < 3 {
        return None;
    }
    Some(t)
}

/// El mejor título de reunión entre los de las ventanas.
pub fn best_window_title(titles: &[String]) -> Option<String> {
    titles.iter().filter_map(|t| clean_window_title(t)).next()
}

/// Un evento del calendario (tiempos de pared).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarEntry {
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
}

/// El evento que corresponde a una reunión que empezó en `started` (y acabó
/// en `ended`, si se sabe): empieza a menos de 20 min de distancia y es el que
/// más se solapa. Se ignoran los de todo el día y los títulos vacíos.
pub fn pick_calendar_title(events: &[CalendarEntry], started: i64, ended: Option<i64>) -> Option<String> {
    const NEAR: i64 = 20 * 60_000;
    let end = ended.unwrap_or(started + 30 * 60_000).max(started + 60_000);
    events
        .iter()
        .filter(|e| !e.all_day && !e.title.trim().is_empty() && (e.start_ms - started).abs() <= NEAR && e.end_ms > started && e.start_ms < end)
        .max_by_key(|e| (e.end_ms.min(end) - e.start_ms.max(started), -(e.start_ms - started).abs()))
        .map(|e| e.title.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn teams_window_titles_give_the_meeting_name_and_generic_ones_give_nothing() {
        assert_eq!(clean_window_title("Daily del equipo | Microsoft Teams").as_deref(), Some("Daily del equipo"));
        assert_eq!(clean_window_title("Reunión: Revisión LOPD | Microsoft Teams").as_deref(), Some("Revisión LOPD"));
        assert_eq!(clean_window_title("Meeting in \"Sprint review\" | Microsoft Teams").as_deref(), Some("Sprint review"));
        for g in ["Microsoft Teams", "Chat | Microsoft Teams", "Calendario | Microsoft Teams", "Contenido compartido de Ana | Microsoft Teams", "Reunión de Teams", ""] {
            assert_eq!(clean_window_title(g), None, "{g}");
        }
        let all = ["Chat | Microsoft Teams".to_string(), "Daily: subcuentas | Microsoft Teams".to_string()];
        assert_eq!(best_window_title(&all).as_deref(), Some("Daily: subcuentas"));
        assert!(is_generic_title("Reunión de Teams") && is_generic_title("Grabación") && !is_generic_title("Daily"));
    }

    #[test]
    fn the_calendar_event_is_the_one_that_starts_near_and_overlaps_most() {
        let e = |t: &str, s: i64, d: i64| CalendarEntry { title: t.into(), start_ms: s, end_ms: s + d, all_day: false };
        let min = 60_000;
        let started = 1_000 * min;
        let events = vec![
            e("Comida", started - 90 * min, 60 * min),
            e("Daily del equipo", started - 2 * min, 15 * min),
            e("Refinamiento", started + 10 * min, 60 * min),
            CalendarEntry { title: "Vacaciones".into(), start_ms: started - 600 * min, end_ms: started + 600 * min, all_day: true },
        ];
        assert_eq!(pick_calendar_title(&events, started, Some(started + 9 * min)).as_deref(), Some("Daily del equipo"));
        assert_eq!(pick_calendar_title(&events[2..3], started, Some(started + 9 * min)), None, "empieza después de acabar");
        assert_eq!(pick_calendar_title(&[], started, None), None);
    }
}
