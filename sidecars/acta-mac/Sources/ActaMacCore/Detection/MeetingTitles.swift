// meeting.titles — títulos de las ventanas de la app de la reunión (el nuevo
// Teams pone el nombre de la reunión en el título de su ventana) y
// calendar.events — eventos del Calendario de macOS (EventKit; Outlook /
// Exchange suelen estar sincronizados ahí). Rust elige el título bueno.

import ActaMacProtocol
import EventKit
import Foundation
import ScreenCaptureKit

public enum MeetingTitles {
    public static func read(pid: Int32) async -> MeetingTitlesResult {
        var titles: [String] = []
        if AXSnapshot.isTrusted() {
            let r = TeamsAX.readLive(pid: pid)
            if let t = r.meetingWindowTitle { titles.append(t) }
            titles += AXSnapshot.windows(pid: pid).compactMap(\.title)
        }
        if let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) {
            titles += content.windows.filter { $0.owningApplication?.processID == pid }.compactMap(\.title)
        }
        var seen = Set<String>()
        return MeetingTitlesResult(titles: titles.filter { !$0.isEmpty && seen.insert($0).inserted })
    }
}

public enum CalendarReader {
    static func access() -> String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .authorized: "granted"
        case .notDetermined: "not_determined"
        default: "denied"
        }
    }

    public static func events(_ a: CalendarEventsArgs) async -> CalendarEventsResult {
        let store = EKEventStore()
        if access() == "not_determined", a.requestAccess {
            _ = try? await store.requestFullAccessToEvents()
        }
        guard access() == "granted" else { return CalendarEventsResult(access: access(), events: []) }
        let from = Date(timeIntervalSince1970: Double(a.fromUnixMs) / 1000)
        let to = Date(timeIntervalSince1970: Double(a.toUnixMs) / 1000)
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
        let events = store.events(matching: predicate).map {
            CalendarEventWire(
                title: $0.title ?? "",
                startUnixMs: Int64($0.startDate.timeIntervalSince1970 * 1000),
                endUnixMs: Int64($0.endDate.timeIntervalSince1970 * 1000),
                allDay: $0.isAllDay
            )
        }
        return CalendarEventsResult(access: "granted", events: events)
    }
}
