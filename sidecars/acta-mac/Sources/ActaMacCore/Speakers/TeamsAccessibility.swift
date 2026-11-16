// Teams por Accesibilidad: ventana de reunión, roster, hablante activo y
// presentador. Heurísticas sobre etiquetas (inglés y castellano) porque la UI
// web de Teams no expone roles semánticos estables. Si nada encaja, no se
// emite nada (nunca error). Hay que calibrarlas con un volcado real
// (ACTA_AX_DUMP_DIR, ver docs de verificación manual).

import ActaMacProtocol
import Foundation

struct RosterEntry: Equatable, Sendable {
    var name: String
    var isSelf: Bool
    var muted: Bool?
}

struct TeamsReading: Equatable, Sendable {
    var meetingWindowTitle: String?
    var isMeeting: Bool
    var roster: [RosterEntry]
    var activeSpeakers: [String]
    /// `nil` = no se sabe; `""` = presenta "yo".
    var presenter: String?
    var sharing: Bool?
}

enum TeamsAX {
    // Controles que solo existen dentro de una llamada.
    static let leaveLabels = ["leave", "hang up", "end call", "salir", "abandonar", "colgar", "finalizar llamada", "finalizar reunión"]
    static let callControlLabels = ["mute", "unmute", "silenciar", "activar micrófono", "desactivar micrófono", "camera", "cámara", "share", "compartir"]
    static let rosterContainerLabels = ["participants", "participantes", "people", "personas", "in this meeting", "en esta reunión", "in the meeting", "en la reunión", "attendees", "asistentes"]
    static let selfMarkers = ["(you)", "(tú)", "(tu)", "(yo)", "(me)", "(usted)"]
    static let mutedMarkers = ["muted", "mic off", "microphone off", "silenciado", "silenciada", "micrófono desactivado", "micro desactivado"]
    static let unmutedMarkers = ["unmuted", "mic on", "micrófono activado"]
    static let speakingPatterns = [
        #"^(.+?),?\s+(?:is\s+)?speaking\b"#,
        #"^(.+?),?\s+(?:está\s+)?hablando\b"#,
        #"^speaking:?\s+(.+)$"#,
        #"^hablando:?\s+(.+)$"#,
    ]
    static let presentingPatterns = [
        #"^(.+?)\s+is\s+(?:presenting|sharing)"#,
        #"^(.+?)\s+está\s+(?:presentando|compartiendo)"#,
    ]
    static let selfPresentingLabels = ["you're presenting", "you are presenting", "estás presentando", "está presentando su pantalla", "stop presenting", "dejar de presentar", "detener la presentación"]
    static let suffixNoise = ["(guest)", "(invitado)", "(invitada)", "(external)", "(externo)", "(organizer)", "(organizador)", "(organizadora)", "(unverified)"]

    static func isLeaveButton(_ n: AXNode) -> Bool {
        guard n.role == "AXButton" || n.role == "AXMenuButton" else { return false }
        return n.labels.contains { l in
            let s = l.lowercased()
            return leaveLabels.contains { s == $0 || s.hasPrefix($0 + " ") || s.hasPrefix($0 + "(") }
        }
    }

    /// Ventana de llamada: tiene botón de colgar, o ≥ 2 controles de llamada.
    static func isMeetingWindow(_ window: AXNode) -> Bool {
        if window.first(where: isLeaveButton) != nil { return true }
        var controls = Set<String>()
        window.walk { n, _ in
            guard n.role == "AXButton" || n.role == "AXCheckBox" || n.role == "AXToggle" else { return }
            for l in n.labels {
                let s = l.lowercased()
                for c in callControlLabels where s.hasPrefix(c) { controls.insert(c) }
            }
        }
        return controls.count >= 2
    }

    static func matchFirst(_ patterns: [String], _ text: String) -> String? {
        for p in patterns {
            guard let re = try? NSRegularExpression(pattern: p, options: [.caseInsensitive]) else { continue }
            let range = NSRange(text.startIndex..., in: text)
            if let m = re.firstMatch(in: text, range: range), m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: text) {
                return String(text[r])
            }
        }
        return nil
    }

    /// "Ana García (Guest), Muted" → "Ana García".
    static func cleanName(_ raw: String) -> String? {
        var s = raw.split(separator: ",", maxSplits: 1).first.map(String.init) ?? raw
        for marker in selfMarkers + suffixNoise {
            if let r = s.range(of: marker, options: .caseInsensitive) { s.removeSubrange(r) }
        }
        s = s.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        guard s.count >= 2, s.count <= 80 else { return nil }
        let low = s.lowercased()
        let banned = leaveLabels + callControlLabels + rosterContainerLabels + ["more options", "más opciones", "video", "vídeo", "chat", "raise", "levantar"]
        if banned.contains(where: { low == $0 }) { return nil }
        return s
    }

    static func isSelf(_ label: String) -> Bool {
        let s = label.lowercased()
        return selfMarkers.contains { s.contains($0) }
    }

    static func muted(_ label: String) -> Bool? {
        let s = label.lowercased()
        if unmutedMarkers.contains(where: { s.contains($0) }) { return false }
        if mutedMarkers.contains(where: { s.contains($0) }) { return true }
        return nil
    }

    /// Roster: filas dentro de un contenedor "Participantes/People".
    static func roster(_ root: AXNode) -> [RosterEntry] {
        var out: [RosterEntry] = []
        var seen = Set<String>()
        func collect(_ container: AXNode) {
            // Un contenedor anidado ("In this meeting (3)") no es una fila: lo
            // recoge su propia visita (gana la lista más interna).
            for row in container.children where !isRosterContainer(row) && !listRoles.contains(row.role ?? "") {
                // Primera etiqueta con pinta de nombre en la fila o sus hijos.
                var label: String?
                row.walk { n, depth in
                    guard label == nil, depth <= 4 else { return }
                    if let l = n.labels.first(where: { cleanName($0) != nil }) { label = l }
                }
                guard let l = label, let name = cleanName(l), !seen.contains(name.lowercased()) else { continue }
                seen.insert(name.lowercased())
                let all = row.labels + row.children.flatMap(\.labels)
                out.append(RosterEntry(
                    name: name,
                    isSelf: all.contains(where: isSelf),
                    muted: all.lazy.compactMap(muted).first
                ))
            }
        }
        root.walk { n, _ in
            if isRosterContainer(n), (listRoles + ["AXGroup"]).contains(n.role ?? "") {
                collect(n)
            }
        }
        return out
    }

    static let listRoles = ["AXList", "AXOutline", "AXTable"]

    /// "Participants", "In this meeting (3)", "Participantes (5)"...
    static func isRosterContainer(_ n: AXNode) -> Bool {
        n.labels.contains { l in
            let s = l.lowercased()
            return rosterContainerLabels.contains { s == $0 || s.hasPrefix($0 + " (") || (s.hasPrefix($0 + " ") && s.count < $0.count + 6) }
        }
    }

    static func activeSpeakers(_ root: AXNode) -> [String] {
        var names: [String] = []
        root.walk { n, _ in
            for l in n.labels {
                if let raw = matchFirst(speakingPatterns, l), let name = cleanName(raw), !names.contains(name) {
                    names.append(name)
                }
            }
        }
        return names
    }

    static func presenter(_ root: AXNode) -> (sharing: Bool, presenter: String?)? {
        var result: (Bool, String?)?
        root.walk { n, _ in
            guard result == nil else { return }
            for l in n.labels {
                let s = l.lowercased()
                if selfPresentingLabels.contains(where: { s.contains($0) }) {
                    result = (true, "")
                    return
                }
                if let raw = matchFirst(presentingPatterns, l), let name = cleanName(raw) {
                    result = (true, name)
                    return
                }
            }
        }
        return result
    }

    static func read(windows: [AXNode]) -> TeamsReading {
        let meeting = windows.first(where: isMeetingWindow)
        guard let w = meeting else {
            return TeamsReading(meetingWindowTitle: nil, isMeeting: false, roster: [], activeSpeakers: [], presenter: nil, sharing: nil)
        }
        let p = presenter(w)
        // El panel de participantes puede estar en otra ventana (pop-out).
        let roster = windows.lazy.map(Self.roster).first { !$0.isEmpty } ?? []
        return TeamsReading(
            meetingWindowTitle: w.title,
            isMeeting: true,
            roster: roster,
            activeSpeakers: activeSpeakers(w),
            presenter: p?.presenter,
            sharing: p?.sharing
        )
    }

    /// Lectura real (AX) de una app.
    static func readLive(pid: pid_t) -> TeamsReading {
        let wins = AXSnapshot.windows(pid: pid)
        return read(windows: wins)
    }
}

/// speakers.watch: sondea el AX de Teams cada segundo y emite roster y
/// hablante activo SOLO cuando cambian.
public actor SpeakersService {
    private let output: Output
    private var task: Task<Void, Never>?

    public init(output: Output) { self.output = output }

    public func watch(_ a: SpeakersWatchArgs) {
        task?.cancel()
        let output = output
        task = Task.detached(priority: .utility) {
            var lastRoster: [RosterEntry]?
            var lastActive: [String]?
            var lastDump = Date.distantPast
            var warned = false
            while !Task.isCancelled {
                if AXSnapshot.isTrusted() {
                    let wins = AXSnapshot.windows(pid: a.pid)
                    if Date().timeIntervalSince(lastDump) > 30 {
                        AXSnapshot.dumpIfRequested(wins, tag: "teams")
                        lastDump = Date()
                    }
                    let r = TeamsAX.read(windows: wins)
                    if r.isMeeting {
                        if !r.roster.isEmpty, r.roster != lastRoster {
                            lastRoster = r.roster
                            await output.emit(.speakersRoster(SpeakersRosterEvent(
                                pid: a.pid,
                                participants: r.roster.map { ParticipantWire(name: $0.name, isSelf: $0.isSelf, muted: $0.muted) }
                            )))
                        }
                        if r.activeSpeakers != (lastActive ?? []) || lastActive == nil && !r.activeSpeakers.isEmpty {
                            lastActive = r.activeSpeakers
                            await output.emit(.speakersActive(SpeakersActiveEvent(pid: a.pid, names: r.activeSpeakers)))
                        }
                    }
                } else if !warned {
                    warned = true
                    await output.log("warn", "speakers.watch: Accessibility not granted; no speaker names")
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    public func unwatch() {
        task?.cancel()
        task = nil
    }
}
