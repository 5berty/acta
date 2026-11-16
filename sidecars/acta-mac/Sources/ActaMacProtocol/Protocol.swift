// Protocolo sidecar ⇄ Rust, versión 1.
// Espejo EXACTO de crates/acta-mac-bridge/src/protocol.rs.
// Especificación: docs/01-arquitectura.md §4.
//
// - stdin  (Rust → sidecar): {"id":7,"cmd":"capture.start","args":{...}}  (sin "args" si no hay)
// - stdout (sidecar → Rust): {"type":"response",...} | {"type":"event","ts":...,"event":"...","data":{...}}
// - stderr: logs en texto libre. NUNCA protocolo por stderr ni logs por stdout.
//
// Claves snake_case vía JSONEncoder/Decoder (.convertToSnakeCase / .convertFromSnakeCase).
// OJO con los acrónimos: la propiedad Swift debe ser `bundleIds`, no `bundleIDs`.

import Foundation

public let protocolVersion: UInt32 = 1
public let maxLineBytes = 1024 * 1024

public enum ProtocolCoding {
    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.outputFormatting = [.withoutEscapingSlashes]
        return e
    }
}

// MARK: - Enums compartidos

public enum TrackName: String, Codable, Sendable { case mic, system }

public enum PermissionName: String, Codable, Sendable {
    case microphone, systemAudio = "system_audio", screenRecording = "screen_recording", accessibility, automation
}

public enum PermissionStatusName: String, Codable, Sendable {
    case granted, denied, notDetermined = "not_determined", unknown
}

public enum CaptureReasonName: String, Codable, Sendable {
    case slideChange = "slide_change", keyword, llmPick = "llm_pick", manual, candidate
}

public enum TrackStateName: String, Codable, Sendable { case running, stalled, restarting, stopped, failed }

public enum SignalName: String, Codable, Sendable {
    case micInUse = "mic_in_use", micReleased = "mic_released"
    case meetingWindowOpen = "meeting_window_open", meetingWindowClosed = "meeting_window_closed"
    case meetTabOpen = "meet_tab_open", meetTabClosed = "meet_tab_closed"
    case audioPidsChanged = "audio_pids_changed"
}

public enum ErrorCode: String, Codable, Sendable {
    case permissionDenied = "permission_denied", notFound = "not_found", unsupported
    case invalidArgs = "invalid_args", busy, cancelled, internalError = "internal"
}

// MARK: - Argumentos de comandos

public struct HelloArgs: Codable, Sendable, Equatable { public var protocolVersion: UInt32 }

public struct PermissionsRequestArgs: Codable, Sendable, Equatable {
    public var kind: PermissionName
    public var target: String?
}

public struct AppRuleWire: Codable, Sendable, Equatable {
    public var bundleId: String
    public var platform: String
    public var isBrowser: Bool
}

public struct DetectStartArgs: Codable, Sendable, Equatable {
    public var rules: [AppRuleWire]
    public var meetUrlPatterns: [String]
    public var pollMs: UInt32
}

public struct MicArgs: Codable, Sendable, Equatable {
    public var enabled: Bool
    public var deviceUid: String?
}

public struct SystemArgs: Codable, Sendable, Equatable {
    public var enabled: Bool
    public var pids: [Int32]
    public var bundleIds: [String]
}

public struct CaptureStartArgs: Codable, Sendable, Equatable {
    public var sessionId: String
    public var sampleRate: UInt32
    public var frameMs: UInt32
    public var mic: MicArgs
    public var system: SystemArgs
}

public struct CaptureRetargetArgs: Codable, Sendable, Equatable {
    public var pids: [Int32]
    public var bundleIds: [String]
}

public struct SpeakersWatchArgs: Codable, Sendable, Equatable {
    public var pid: Int32
    public var bundleId: String
}

public struct ScreenStartArgs: Codable, Sendable, Equatable {
    public var sessionId: String
    public var pid: Int32
    public var bundleId: String
    public var windowTitleHint: String?
    public var outDir: String
    public var candidatesDir: String
    public var fps: Float
    public var phashThreshold: UInt32
    public var stableFrames: UInt32
    public var candidateEveryS: UInt32
    public var ringSeconds: UInt32
    public var maxWidth: UInt32
    public var format: String
}

public struct ScreenSnapshotArgs: Codable, Sendable, Equatable {
    public var reason: CaptureReasonName
    public var atUnixMs: Int64
    public var keyword: String?
}

public struct AsrTranscribeArgs: Codable, Sendable, Equatable {
    public var jobId: String
    public var wavPath: String
    public var outPath: String
    public var language: String?
    public var model: String
}

public struct AsrLiveStartArgs: Codable, Sendable, Equatable {
    public var tracks: [TrackName]
    public var language: String?
}

public struct DiarizeRunArgs: Codable, Sendable, Equatable {
    public var jobId: String
    public var wavPath: String
    public var outPath: String
    public var numSpeakers: UInt8?
    public var minSpeakers: UInt8?
    public var maxSpeakers: UInt8?
}

public struct SpanMs: Codable, Sendable, Equatable {
    public var startMs: UInt64
    public var endMs: UInt64
}

public struct VoiceprintEmbedArgs: Codable, Sendable, Equatable {
    public var wavPath: String
    public var spans: [SpanMs]
}

public struct ModelsDownloadArgs: Codable, Sendable, Equatable { public var name: String }

public struct JobCancelArgs: Codable, Sendable, Equatable { public var jobId: String }

// MARK: - Comandos

public enum Command: Sendable, Equatable {
    case hello(HelloArgs)
    case shutdown
    case permissionsStatus
    case permissionsRequest(PermissionsRequestArgs)
    case devicesList
    case appsList
    case detectStart(DetectStartArgs)
    case detectStop
    case captureStart(CaptureStartArgs)
    case capturePause
    case captureResume
    case captureStop
    case captureRetarget(CaptureRetargetArgs)
    case speakersWatch(SpeakersWatchArgs)
    case speakersUnwatch
    case screenStart(ScreenStartArgs)
    case screenSnapshot(ScreenSnapshotArgs)
    case screenStop
    case asrTranscribe(AsrTranscribeArgs)
    case asrLiveStart(AsrLiveStartArgs)
    case asrLiveStop
    case diarizeRun(DiarizeRunArgs)
    case voiceprintEmbed(VoiceprintEmbedArgs)
    case modelsStatus
    case modelsDownload(ModelsDownloadArgs)
    case jobCancel(JobCancelArgs)
}

public enum RequestDecodingError: Error, Equatable {
    /// El comando no existe; se conoce el id para responder con error.
    case unknownCommand(id: UInt64, cmd: String)
}

/// Una línea de stdin.
public struct Request: Decodable, Sendable, Equatable {
    public let id: UInt64
    public let command: Command

    enum CodingKeys: String, CodingKey { case id, cmd, args }

    public init(id: UInt64, command: Command) {
        self.id = id
        self.command = command
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UInt64.self, forKey: .id)
        let cmd = try c.decode(String.self, forKey: .cmd)
        func args<T: Decodable>(_: T.Type) throws -> T { try c.decode(T.self, forKey: .args) }
        switch cmd {
        case "hello": command = .hello(try args(HelloArgs.self))
        case "shutdown": command = .shutdown
        case "permissions.status": command = .permissionsStatus
        case "permissions.request": command = .permissionsRequest(try args(PermissionsRequestArgs.self))
        case "devices.list": command = .devicesList
        case "apps.list": command = .appsList
        case "detect.start": command = .detectStart(try args(DetectStartArgs.self))
        case "detect.stop": command = .detectStop
        case "capture.start": command = .captureStart(try args(CaptureStartArgs.self))
        case "capture.pause": command = .capturePause
        case "capture.resume": command = .captureResume
        case "capture.stop": command = .captureStop
        case "capture.retarget": command = .captureRetarget(try args(CaptureRetargetArgs.self))
        case "speakers.watch": command = .speakersWatch(try args(SpeakersWatchArgs.self))
        case "speakers.unwatch": command = .speakersUnwatch
        case "screen.start": command = .screenStart(try args(ScreenStartArgs.self))
        case "screen.snapshot": command = .screenSnapshot(try args(ScreenSnapshotArgs.self))
        case "screen.stop": command = .screenStop
        case "asr.transcribe": command = .asrTranscribe(try args(AsrTranscribeArgs.self))
        case "asr.live.start": command = .asrLiveStart(try args(AsrLiveStartArgs.self))
        case "asr.live.stop": command = .asrLiveStop
        case "diarize.run": command = .diarizeRun(try args(DiarizeRunArgs.self))
        case "voiceprint.embed": command = .voiceprintEmbed(try args(VoiceprintEmbedArgs.self))
        case "models.status": command = .modelsStatus
        case "models.download": command = .modelsDownload(try args(ModelsDownloadArgs.self))
        case "job.cancel": command = .jobCancel(try args(JobCancelArgs.self))
        default: throw RequestDecodingError.unknownCommand(id: id, cmd: cmd)
        }
    }
}

// MARK: - Respuestas

public struct ProtocolError: Codable, Sendable, Equatable, Error {
    public var code: ErrorCode
    public var message: String
    public init(code: ErrorCode, message: String) {
        self.code = code
        self.message = message
    }
}

/// `{"type":"response","id":..,"ok":..,"result"?:..,"error"?:..}`
public struct ResponseLine<R: Encodable & Sendable>: Encodable, Sendable {
    public let type = "response"
    public var id: UInt64
    public var ok: Bool
    public var result: R?
    public var error: ProtocolError?

    public static func success(_ id: UInt64, _ result: R) -> Self {
        .init(id: id, ok: true, result: result, error: nil)
    }

    enum CodingKeys: String, CodingKey { case type, id, ok, result, error }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(id, forKey: .id)
        try c.encode(ok, forKey: .ok)
        try c.encodeIfPresent(result, forKey: .result)
        try c.encodeIfPresent(error, forKey: .error)
    }
}

/// Resultado vacío `{}`.
public struct Empty: Codable, Sendable, Equatable { public init() {} }

public extension ResponseLine where R == Empty {
    static func failure(_ id: UInt64, _ error: ProtocolError) -> Self {
        .init(id: id, ok: false, result: nil, error: error)
    }
}

public struct HelloResult: Codable, Sendable, Equatable {
    public var sidecarVersion: String
    public var protocolVersion: UInt32
    public var macosVersion: String
    public var capabilities: [String]
    public init(sidecarVersion: String, protocolVersion: UInt32, macosVersion: String, capabilities: [String]) {
        self.sidecarVersion = sidecarVersion
        self.protocolVersion = protocolVersion
        self.macosVersion = macosVersion
        self.capabilities = capabilities
    }
}

public struct PermissionEntry: Codable, Sendable, Equatable {
    public var kind: PermissionName
    public var status: PermissionStatusName
    public var target: String?
}

public struct PermissionsStatusResult: Codable, Sendable, Equatable { public var permissions: [PermissionEntry] }
public struct PermissionsRequestResult: Codable, Sendable, Equatable { public var status: PermissionStatusName }

public struct DeviceWire: Codable, Sendable, Equatable {
    public var uid: String
    public var name: String
    public var isDefault: Bool
    public var transport: String
}

public struct DevicesListResult: Codable, Sendable, Equatable {
    public var inputs: [DeviceWire]
    public var outputs: [DeviceWire]
}

public struct AppInfoWire: Codable, Sendable, Equatable {
    public var pid: Int32
    public var bundleId: String
    public var name: String
    public var audioPids: [Int32]
}

public struct AppsListResult: Codable, Sendable, Equatable { public var apps: [AppInfoWire] }

public struct CaptureStartResult: Codable, Sendable, Equatable {
    public var startedAtUnixMs: Int64
    public var micDevice: String?
    public var systemPids: [Int32]
}

public struct ScreenFrameEvent: Codable, Sendable, Equatable {
    public var path: String
    public var atUnixMs: Int64
    public var reason: CaptureReasonName
    public var phash: String
    public var width: UInt32
    public var height: UInt32
    public var keyword: String?
}

public struct ScreenSnapshotResult: Codable, Sendable, Equatable { public var frame: ScreenFrameEvent? }

public struct AsrTranscribeResult: Codable, Sendable, Equatable {
    public var outPath: String
    public var segments: UInt32
    public var durationMs: UInt64
}

public struct DiarizeRunResult: Codable, Sendable, Equatable {
    public var outPath: String
    public var speakers: UInt32
}

public struct VoiceprintEmbedResult: Codable, Sendable, Equatable {
    public var embedding: [Float]
    public var model: String
}

public struct ModelStatusWire: Codable, Sendable, Equatable {
    public var name: String
    public var downloaded: Bool
    public var bytes: UInt64?
}

public struct ModelsStatusResult: Codable, Sendable, Equatable { public var models: [ModelStatusWire] }

// MARK: - Eventos

public struct AudioFrameEvent: Codable, Sendable, Equatable {
    public var track: TrackName
    public var seq: UInt64
    public var ptsUs: UInt64
    public var sampleRate: UInt32
    public var channels: UInt16
    public var format: String
    /// PCM s16le en base64.
    public var data: String
}

public struct AudioDeviceChangedEvent: Codable, Sendable, Equatable {
    public var track: TrackName
    public var deviceUid: String?
    public var deviceName: String?
    public var reason: String
}

public struct AudioTrackStateEvent: Codable, Sendable, Equatable {
    public var track: TrackName
    public var state: TrackStateName
    public var message: String?
}

public struct AudioOverrunEvent: Codable, Sendable, Equatable {
    public var track: TrackName
    public var droppedFrames: UInt64
}

public struct DetectSignalEvent: Codable, Sendable, Equatable {
    public var signal: SignalName
    public var app: AppInfoWire
    public var windowTitle: String?
    public var url: String?
}

public struct ParticipantWire: Codable, Sendable, Equatable {
    public var name: String
    public var isSelf: Bool
    public var muted: Bool?
}

public struct SpeakersRosterEvent: Codable, Sendable, Equatable {
    public var pid: Int32
    public var participants: [ParticipantWire]
}

public struct SpeakersActiveEvent: Codable, Sendable, Equatable {
    public var pid: Int32
    public var names: [String]
}

public struct ScreenShareStateEvent: Codable, Sendable, Equatable {
    public var sharing: Bool
    public var presenter: String?
    public var source: String
}

public struct AsrPartialEvent: Codable, Sendable, Equatable {
    public var track: TrackName
    public var text: String
    public var atUnixMs: Int64
    public var isFinal: Bool
}

public struct JobProgressEvent: Codable, Sendable, Equatable {
    public var jobId: String
    public var fraction: Float
    public var stage: String?
}

public struct ModelsProgressEvent: Codable, Sendable, Equatable {
    public var name: String
    public var fraction: Float
    public var done: Bool
    public var error: String?
}

public struct PermissionsChangedEvent: Codable, Sendable, Equatable {
    public var kind: PermissionName
    public var status: PermissionStatusName
}

public struct LogEvent: Codable, Sendable, Equatable {
    public var level: String
    public var message: String
}

public struct FatalEvent: Codable, Sendable, Equatable { public var message: String }

public enum Event: Sendable, Equatable {
    case audioFrame(AudioFrameEvent)
    case audioDeviceChanged(AudioDeviceChangedEvent)
    case audioTrackState(AudioTrackStateEvent)
    case audioOverrun(AudioOverrunEvent)
    case detectSignal(DetectSignalEvent)
    case speakersRoster(SpeakersRosterEvent)
    case speakersActive(SpeakersActiveEvent)
    case screenShareState(ScreenShareStateEvent)
    case screenFrame(ScreenFrameEvent)
    case asrPartial(AsrPartialEvent)
    case jobProgress(JobProgressEvent)
    case modelsProgress(ModelsProgressEvent)
    case permissionsChanged(PermissionsChangedEvent)
    case log(LogEvent)
    case fatal(FatalEvent)

    public var name: String {
        switch self {
        case .audioFrame: "audio.frame"
        case .audioDeviceChanged: "audio.device_changed"
        case .audioTrackState: "audio.track_state"
        case .audioOverrun: "audio.overrun"
        case .detectSignal: "detect.signal"
        case .speakersRoster: "speakers.roster"
        case .speakersActive: "speakers.active"
        case .screenShareState: "screen.share_state"
        case .screenFrame: "screen.frame"
        case .asrPartial: "asr.partial"
        case .jobProgress: "job.progress"
        case .modelsProgress: "models.progress"
        case .permissionsChanged: "permissions.changed"
        case .log: "log"
        case .fatal: "fatal"
        }
    }
}

/// `{"type":"event","ts":<unix ms>,"event":"<name>","data":{...}}`
public struct EventLine: Encodable, Sendable {
    public var ts: Int64
    public var event: Event

    public init(ts: Int64, event: Event) {
        self.ts = ts
        self.event = event
    }

    enum CodingKeys: String, CodingKey { case type, ts, event, data }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("event", forKey: .type)
        try c.encode(ts, forKey: .ts)
        try c.encode(event.name, forKey: .event)
        switch event {
        case .audioFrame(let d): try c.encode(d, forKey: .data)
        case .audioDeviceChanged(let d): try c.encode(d, forKey: .data)
        case .audioTrackState(let d): try c.encode(d, forKey: .data)
        case .audioOverrun(let d): try c.encode(d, forKey: .data)
        case .detectSignal(let d): try c.encode(d, forKey: .data)
        case .speakersRoster(let d): try c.encode(d, forKey: .data)
        case .speakersActive(let d): try c.encode(d, forKey: .data)
        case .screenShareState(let d): try c.encode(d, forKey: .data)
        case .screenFrame(let d): try c.encode(d, forKey: .data)
        case .asrPartial(let d): try c.encode(d, forKey: .data)
        case .jobProgress(let d): try c.encode(d, forKey: .data)
        case .modelsProgress(let d): try c.encode(d, forKey: .data)
        case .permissionsChanged(let d): try c.encode(d, forKey: .data)
        case .log(let d): try c.encode(d, forKey: .data)
        case .fatal(let d): try c.encode(d, forKey: .data)
        }
    }
}

// MARK: - Ficheros de salida de trabajos largos

public struct AsrWordWire: Codable, Sendable, Equatable {
    public var startMs: UInt64
    public var endMs: UInt64
    public var text: String
}

public struct AsrSegmentWire: Codable, Sendable, Equatable {
    public var startMs: UInt64
    public var endMs: UInt64
    public var text: String
    public var confidence: Float?
    public var words: [AsrWordWire]
}

/// `transcript/asr-<track>.json`
public struct AsrFile: Codable, Sendable, Equatable {
    public var model: String
    public var language: String?
    public var durationMs: UInt64
    public var segments: [AsrSegmentWire]
}

public struct DiarizationTurnWire: Codable, Sendable, Equatable {
    public var label: String
    public var startMs: UInt64
    public var endMs: UInt64
}

public struct DiarizedSpeakerWire: Codable, Sendable, Equatable {
    public var label: String
    public var embedding: [Float]
    public var totalMs: UInt64
}

/// `transcript/diarization.json`
public struct DiarizationFile: Codable, Sendable, Equatable {
    public var embeddingModel: String
    public var turns: [DiarizationTurnWire]
    public var speakers: [DiarizedSpeakerWire]
}
