// Agrupar procesos de audio por app dueña (lógica pura).
//
// Teams y los navegadores reproducen/capturan desde procesos helper
// (`com.microsoft.teams2.helper`, `com.google.Chrome.helper`, el GPU process
// de WebKit...). Para el process tap y para "mic en uso" hay que juntarlos
// bajo la app principal.

import Foundation

struct AppAudio: Equatable, Sendable {
    var bundleId: String
    var mainPid: pid_t
    var name: String
    /// PIDs de la app que la HAL conoce (helpers incluidos), ordenados.
    var audioPids: [pid_t]
    /// Algún proceso de la app captura del micro.
    var micInUse: Bool
    /// Algún proceso de la app reproduce audio.
    var outputActive: Bool
}

struct ProcessOwner: Equatable, Sendable {
    var bundleId: String
    var pid: pid_t
    var name: String
}

enum AppResolution {
    /// Dueño por prefijo de bundle id: `com.google.Chrome.helper.renderer` →
    /// `com.google.Chrome` si está en `known`. El más largo gana.
    static func ownerByPrefix(_ bundle: String, known: [String]) -> String? {
        known
            .filter { bundle == $0 || bundle.hasPrefix($0 + ".") }
            .max { $0.count < $1.count }
    }

    /// Agrupa procesos por dueño. `owner` resuelve cada proceso (responsable
    /// del sistema, prefijo o él mismo); los que devuelven `nil` se ignoran.
    static func group(_ procs: [AudioProcessInfo], owner: (AudioProcessInfo) -> ProcessOwner?) -> [String: AppAudio] {
        var apps: [String: AppAudio] = [:]
        for p in procs {
            guard let o = owner(p) else { continue }
            var app = apps[o.bundleId] ?? AppAudio(
                bundleId: o.bundleId, mainPid: o.pid, name: o.name, audioPids: [], micInUse: false, outputActive: false
            )
            if !app.audioPids.contains(p.pid) { app.audioPids.append(p.pid) }
            if !app.audioPids.contains(o.pid) { app.audioPids.append(o.pid) }
            app.micInUse = app.micInUse || p.runningInput
            app.outputActive = app.outputActive || p.runningOutput
            app.audioPids.sort()
            apps[o.bundleId] = app
        }
        return apps
    }
}

/// Apps de dictado que usan el micro y NUNCA deben disparar una reunión
/// (además de la lista blanca, por si alguien las añade por error).
enum DictationDenylist {
    static let needles = ["typeless", "wispr", "superwhisper", "macwhisper", "whisperflow", "orca"]

    static func isDenied(bundleId: String, name: String) -> Bool {
        let hay = (bundleId + " " + name).lowercased()
        return needles.contains { hay.contains($0) }
    }
}

/// Resolución real de dueños (sistema). Fuera de los tests.
enum LiveOwners {
    static func resolve(known: [String]) -> (AudioProcessInfo) -> ProcessOwner? {
        let me = getpid()
        return { p in
            if p.pid == me { return nil }
            if let r = Responsibility.responsiblePid(p.pid), r != p.pid, let b = RunningApps.bundleId(pid: r) {
                return ProcessOwner(bundleId: b, pid: r, name: RunningApps.name(pid: r) ?? b)
            }
            if let k = AppResolution.ownerByPrefix(p.bundleId, known: known), let main = RunningApps.mainPid(bundleId: k) {
                return ProcessOwner(bundleId: k, pid: main, name: RunningApps.name(pid: main) ?? k)
            }
            let b = p.bundleId.isEmpty ? (RunningApps.bundleId(pid: p.pid) ?? "") : p.bundleId
            guard !b.isEmpty else { return nil }
            return ProcessOwner(bundleId: b, pid: p.pid, name: RunningApps.name(pid: p.pid) ?? b)
        }
    }

    static func apps(known: [String]) -> [String: AppAudio] {
        AppResolution.group(CA.audioProcesses(), owner: resolve(known: known))
    }
}
