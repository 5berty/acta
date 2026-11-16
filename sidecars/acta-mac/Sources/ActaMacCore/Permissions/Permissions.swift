// permissions.status / permissions.request y `permissions.changed`.
//
// TCC atribuye todo a acta.app (proceso responsable del sidecar).
// - Micrófono: AVCaptureDevice.
// - Audio del sistema (process tap): no hay API pública; se usa
//   TCCAccessPreflight/TCCAccessRequest del framework privado TCC con el
//   servicio kTCCServiceAudioCapture (como AudioCap). Si no está → unknown.
// - Pantalla: CGPreflightScreenCaptureAccess / CGRequestScreenCaptureAccess.
// - Accesibilidad: AXIsProcessTrusted(WithOptions).
// - Automatización: AEDeterminePermissionToAutomateTarget por navegador.

import ActaMacProtocol
import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import Foundation

/// Mapeo de códigos a estado (lógica pura, testeable).
enum PermissionMapping {
    /// TCCAccessPreflight: 0 = autorizado, 1 = denegado, otro = sin decidir.
    static func tccPreflight(_ code: Int) -> PermissionStatusName {
        switch code {
        case 0: .granted
        case 1: .denied
        default: .notDetermined
        }
    }

    /// AEDeterminePermissionToAutomateTarget.
    static func appleEvents(_ status: OSStatus) -> PermissionStatusName {
        switch status {
        case noErr: .granted
        case OSStatus(errAEEventNotPermitted): .denied
        case OSStatus(errAEEventWouldRequireUserConsent): .notDetermined
        default: .unknown // procNotFound (-600): la app no está abierta
        }
    }

    static func av(_ s: AVAuthorizationStatus) -> PermissionStatusName {
        switch s {
        case .authorized: .granted
        case .denied, .restricted: .denied
        case .notDetermined: .notDetermined
        @unknown default: .unknown
        }
    }
}

/// Navegadores para Meet (los de Settings.detection.rules por defecto + Brave).
let knownBrowsers = [
    "com.google.Chrome", "company.thebrowser.Browser", "com.microsoft.edgemac",
    "com.brave.Browser", "com.apple.Safari",
]

public enum PermissionProbe {
    private typealias Preflight = @convention(c) (CFString, CFDictionary?) -> Int
    private typealias Request = @convention(c) (CFString, CFDictionary?, @escaping @convention(block) (Bool) -> Void) -> Void

    nonisolated(unsafe) private static let tcc: UnsafeMutableRawPointer? =
        dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW)

    private static var audioCaptureService: CFString { "kTCCServiceAudioCapture" as CFString }

    public static func microphone() -> PermissionStatusName {
        PermissionMapping.av(AVCaptureDevice.authorizationStatus(for: .audio))
    }

    public static func systemAudio() -> PermissionStatusName {
        guard let tcc, let sym = dlsym(tcc, "TCCAccessPreflight") else { return .unknown }
        let fn = unsafeBitCast(sym, to: Preflight.self)
        return PermissionMapping.tccPreflight(fn(audioCaptureService, nil))
    }

    public static func screenRecording() -> PermissionStatusName {
        CGPreflightScreenCaptureAccess() ? .granted : .notDetermined
    }

    public static func accessibility() -> PermissionStatusName {
        AXIsProcessTrusted() ? .granted : .notDetermined
    }

    /// Sin preguntar. `unknown` si el navegador no está abierto.
    public static func automation(_ bundleId: String, ask: Bool = false) -> PermissionStatusName {
        var target = AEAddressDesc()
        let data = Array(bundleId.utf8)
        let created = data.withUnsafeBytes { buf in
            AECreateDesc(DescType(typeApplicationBundleID), buf.baseAddress, buf.count, &target)
        }
        guard created == noErr else { return .unknown }
        defer { AEDisposeDesc(&target) }
        let st = AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
        return PermissionMapping.appleEvents(st)
    }

    static func runningBrowsers() -> [String] {
        knownBrowsers.filter { !NSRunningApplication.runningApplications(withBundleIdentifier: $0).isEmpty }
    }

    public static func all() -> [PermissionEntry] {
        var out = [
            PermissionEntry(kind: .microphone, status: microphone(), target: nil),
            PermissionEntry(kind: .systemAudio, status: systemAudio(), target: nil),
            PermissionEntry(kind: .screenRecording, status: screenRecording(), target: nil),
            PermissionEntry(kind: .accessibility, status: accessibility(), target: nil),
        ]
        let browsers = runningBrowsers()
        if browsers.isEmpty {
            out.append(PermissionEntry(kind: .automation, status: .unknown, target: nil))
        } else {
            out += browsers.map { PermissionEntry(kind: .automation, status: automation($0), target: $0) }
        }
        return out
    }

    // MARK: Peticiones (diálogos del sistema)

    public static func request(_ kind: PermissionName, target: String?) async -> PermissionStatusName {
        switch kind {
        case .microphone:
            _ = await AVCaptureDevice.requestAccess(for: .audio)
            return microphone()
        case .systemAudio:
            guard let tcc, let sym = dlsym(tcc, "TCCAccessRequest") else { return systemAudio() }
            let fn = unsafeBitCast(sym, to: Request.self)
            let granted: Bool = await withCheckedContinuation { c in
                fn(audioCaptureService, nil) { ok in c.resume(returning: ok) }
            }
            return granted ? .granted : systemAudio()
        case .screenRecording:
            // Solo pregunta la primera vez; luego hay que ir a Ajustes.
            return CGRequestScreenCaptureAccess() ? .granted : .denied
        case .accessibility:
            let opts = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            return AXIsProcessTrustedWithOptions(opts) ? .granted : .notDetermined
        case .automation:
            let targets = target.map { [$0] } ?? runningBrowsers()
            guard !targets.isEmpty else { return .unknown }
            // AEDeterminePermission… bloquea hasta que el usuario responde: fuera de cualquier actor.
            let results = await withTaskGroup(of: PermissionStatusName.self) { group in
                for t in targets { group.addTask { automation(t, ask: true) } }
                var all: [PermissionStatusName] = []
                for await r in group { all.append(r) }
                return all
            }
            if results.contains(.denied) { return .denied }
            if results.allSatisfy({ $0 == .granted }) { return .granted }
            return results.first ?? .unknown
        }
    }
}

/// Emite `permissions.changed` cuando cambia algún estado (sondeo cada 5 s).
public actor PermissionsMonitor {
    private let output: Output
    private var last: [String: PermissionStatusName] = [:]
    private var task: Task<Void, Never>?

    public init(output: Output) { self.output = output }

    public func start() {
        guard task == nil else { return }
        last = Self.snapshot()
        task = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await self?.poll()
            }
        }
    }

    public func stop() {
        task?.cancel()
        task = nil
    }

    private static func key(_ e: PermissionEntry) -> String { "\(e.kind.rawValue)|\(e.target ?? "")" }

    private static func snapshot() -> [String: PermissionStatusName] {
        // Sin Automation: consultar Apple Events cada 5 s no compensa.
        let entries = [
            PermissionEntry(kind: .microphone, status: PermissionProbe.microphone(), target: nil),
            PermissionEntry(kind: .systemAudio, status: PermissionProbe.systemAudio(), target: nil),
            PermissionEntry(kind: .screenRecording, status: PermissionProbe.screenRecording(), target: nil),
            PermissionEntry(kind: .accessibility, status: PermissionProbe.accessibility(), target: nil),
        ]
        return Dictionary(uniqueKeysWithValues: entries.map { (key($0), $0.status) })
    }

    private func poll() async {
        let now = Self.snapshot()
        for change in PermissionDiff.changes(old: last, new: now) {
            await output.emit(.permissionsChanged(PermissionsChangedEvent(kind: change.kind, status: change.status)))
        }
        last = now
    }
}

enum PermissionDiff {
    struct Change: Equatable { var kind: PermissionName; var status: PermissionStatusName }

    static func changes(old: [String: PermissionStatusName], new: [String: PermissionStatusName]) -> [Change] {
        new.keys.sorted().compactMap { k in
            guard let s = new[k], old[k] != s,
                  let kind = PermissionName(rawValue: String(k.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false)[0]))
            else { return nil }
            return Change(kind: kind, status: s)
        }
    }
}
