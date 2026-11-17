//! `SupervisorEvent` → evento Tauri (nombre del contrato + payload JSON).

use acta_audio::supervisor::SupervisorEvent;
use acta_core::api::event_names as ev;

pub fn to_tauri(e: &SupervisorEvent) -> (&'static str, serde_json::Value) {
    let json = |v: serde_json::Result<serde_json::Value>| v.unwrap_or(serde_json::Value::Null);
    match e {
        SupervisorEvent::Snapshot(s) => (ev::SESSION_STATE, json(serde_json::to_value(s))),
        SupervisorEvent::Levels(l) => (ev::SESSION_LEVELS, json(serde_json::to_value(l))),
        SupervisorEvent::Health(h) => (ev::SESSION_HEALTH, json(serde_json::to_value(h))),
        SupervisorEvent::CaptureSaved(c) => (ev::CAPTURE_SAVED, json(serde_json::to_value(c))),
        SupervisorEvent::Processing(p) => (ev::PROCESSING_PROGRESS, json(serde_json::to_value(p))),
        SupervisorEvent::MeetingUpdated(m) => (ev::MEETING_UPDATED, json(serde_json::to_value(m))),
        SupervisorEvent::LivePartial(p) => (ev::LIVE_PARTIAL, json(serde_json::to_value(p))),
        SupervisorEvent::LiveTranscript(t) => (ev::LIVE_TRANSCRIPT, json(serde_json::to_value(t))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use acta_core::api::MeetingUpdated;
    use acta_core::ids::MeetingId;
    use acta_core::library::MeetingStatus;
    use acta_core::recording::{Level, Levels};
    use acta_core::time::UnixMs;

    #[test]
    fn names_and_camel_case_payloads_follow_the_contract() {
        let (n, v) = to_tauri(&SupervisorEvent::MeetingUpdated(MeetingUpdated {
            meeting_id: MeetingId::from_u128(1),
            status: MeetingStatus::Ready,
            title: "t".into(),
        }));
        assert_eq!(n, "meeting:updated");
        assert_eq!(v["meetingId"], "00000000-0000-0000-0000-000000000001");
        assert_eq!(v["status"], "ready");
        let (n, v) = to_tauri(&SupervisorEvent::Levels(Levels { mic: Level::SILENT, system: Level::SILENT, at: UnixMs(5) }));
        assert_eq!(n, "session:levels");
        assert_eq!(v["mic"]["allZero"], true);
    }
}
