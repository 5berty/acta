// Constructores de los tipos del protocolo.
//
// Los structs de `ActaMacProtocol` (contrato congelado) no declaran `init`
// públicos, así que el init memberwise es `internal` y no se puede usar desde
// este módulo. Mientras el orquestador no los añada (petición de cambio en el
// informe de WP4), se construyen a través de su conformidad `Decodable`
// pública: diccionario snake_case → JSON → decoder del protocolo. Es barato
// (≈20 frames/s) y los tests cubren cada constructor.

import ActaMacProtocol
import Foundation

enum Wire {
    /// Valor JSON (para anidar) de cualquier tipo del protocolo.
    static func json(_ value: some Encodable) -> Any {
        guard let data = try? ProtocolCoding.encoder().encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else { return NSNull() }
        return obj
    }

    /// Construye `T` desde campos snake_case. Los `nil` se omiten (los
    /// opcionales se decodifican como `nil`).
    static func make<T: Decodable>(_ fields: [String: Any?]) -> T {
        let clean = fields.compactMapValues { $0 }
        do {
            let data = try JSONSerialization.data(withJSONObject: clean, options: [])
            return try ProtocolCoding.decoder().decode(T.self, from: data)
        } catch {
            // Error de programación (campo mal escrito): lo cazan los tests.
            fatalError("Wire.make<\(T.self)> failed: \(error) fields=\(clean.keys.sorted())")
        }
    }
}

// MARK: - Resultados

extension AppInfoWire {
    init(pid: Int32, bundleId: String, name: String, audioPids: [Int32]) {
        self = Wire.make(["pid": pid, "bundle_id": bundleId, "name": name, "audio_pids": audioPids])
    }
}

extension DeviceWire {
    init(uid: String, name: String, isDefault: Bool, transport: String) {
        self = Wire.make(["uid": uid, "name": name, "is_default": isDefault, "transport": transport])
    }
}

extension PermissionEntry {
    init(kind: PermissionName, status: PermissionStatusName, target: String?) {
        self = Wire.make(["kind": kind.rawValue, "status": status.rawValue, "target": target])
    }
}

extension PermissionsStatusResult {
    init(permissions: [PermissionEntry]) {
        self = Wire.make(["permissions": permissions.map(Wire.json)])
    }
}

extension PermissionsRequestResult {
    init(status: PermissionStatusName) {
        self = Wire.make(["status": status.rawValue])
    }
}

extension DevicesListResult {
    init(inputs: [DeviceWire], outputs: [DeviceWire]) {
        self = Wire.make(["inputs": inputs.map(Wire.json), "outputs": outputs.map(Wire.json)])
    }
}

extension AppsListResult {
    init(apps: [AppInfoWire]) {
        self = Wire.make(["apps": apps.map(Wire.json)])
    }
}

extension CaptureStartResult {
    init(startedAtUnixMs: Int64, micDevice: String?, systemPids: [Int32]) {
        self = Wire.make(["started_at_unix_ms": startedAtUnixMs, "mic_device": micDevice, "system_pids": systemPids])
    }
}

extension ScreenFrameEvent {
    init(path: String, atUnixMs: Int64, reason: CaptureReasonName, phash: String, width: UInt32, height: UInt32, keyword: String?) {
        self = Wire.make([
            "path": path, "at_unix_ms": atUnixMs, "reason": reason.rawValue, "phash": phash,
            "width": width, "height": height, "keyword": keyword,
        ])
    }
}

extension ScreenSnapshotResult {
    init(frame: ScreenFrameEvent?) {
        self = Wire.make(["frame": frame.map(Wire.json)])
    }
}

extension AsrTranscribeResult {
    init(outPath: String, segments: UInt32, durationMs: UInt64) {
        self = Wire.make(["out_path": outPath, "segments": segments, "duration_ms": durationMs])
    }
}

extension DiarizeRunResult {
    init(outPath: String, speakers: UInt32) {
        self = Wire.make(["out_path": outPath, "speakers": speakers])
    }
}

extension VoiceprintEmbedResult {
    init(embedding: [Float], model: String) {
        self = Wire.make(["embedding": embedding.map { Double($0) }, "model": model])
    }
}

extension ModelStatusWire {
    init(name: String, downloaded: Bool, bytes: UInt64?) {
        self = Wire.make(["name": name, "downloaded": downloaded, "bytes": bytes])
    }
}

extension ModelsStatusResult {
    init(models: [ModelStatusWire]) {
        self = Wire.make(["models": models.map(Wire.json)])
    }
}

// MARK: - Eventos

extension AudioFrameEvent {
    init(track: TrackName, seq: UInt64, ptsUs: UInt64, sampleRate: UInt32, data: String) {
        self = Wire.make([
            "track": track.rawValue, "seq": seq, "pts_us": ptsUs, "sample_rate": sampleRate,
            "channels": 1, "format": "s16le", "data": data,
        ])
    }
}

extension AudioDeviceChangedEvent {
    init(track: TrackName, deviceUid: String?, deviceName: String?, reason: String) {
        self = Wire.make(["track": track.rawValue, "device_uid": deviceUid, "device_name": deviceName, "reason": reason])
    }
}

extension AudioTrackStateEvent {
    init(track: TrackName, state: TrackStateName, message: String?) {
        self = Wire.make(["track": track.rawValue, "state": state.rawValue, "message": message])
    }
}

extension AudioOverrunEvent {
    init(track: TrackName, droppedFrames: UInt64) {
        self = Wire.make(["track": track.rawValue, "dropped_frames": droppedFrames])
    }
}

extension DetectSignalEvent {
    init(signal: SignalName, app: AppInfoWire, windowTitle: String?, url: String?) {
        self = Wire.make(["signal": signal.rawValue, "app": Wire.json(app), "window_title": windowTitle, "url": url])
    }
}

extension ParticipantWire {
    init(name: String, isSelf: Bool, muted: Bool?) {
        self = Wire.make(["name": name, "is_self": isSelf, "muted": muted])
    }
}

extension SpeakersRosterEvent {
    init(pid: Int32, participants: [ParticipantWire]) {
        self = Wire.make(["pid": pid, "participants": participants.map(Wire.json)])
    }
}

extension SpeakersActiveEvent {
    init(pid: Int32, names: [String]) {
        self = Wire.make(["pid": pid, "names": names])
    }
}

extension ScreenShareStateEvent {
    init(sharing: Bool, presenter: String?, source: String) {
        self = Wire.make(["sharing": sharing, "presenter": presenter, "source": source])
    }
}

extension AsrPartialEvent {
    init(track: TrackName, text: String, atUnixMs: Int64, isFinal: Bool) {
        self = Wire.make(["track": track.rawValue, "text": text, "at_unix_ms": atUnixMs, "is_final": isFinal])
    }
}

extension JobProgressEvent {
    init(jobId: String, fraction: Float, stage: String?) {
        self = Wire.make(["job_id": jobId, "fraction": Double(fraction), "stage": stage])
    }
}

extension ModelsProgressEvent {
    init(name: String, fraction: Float, done: Bool, error: String?) {
        self = Wire.make(["name": name, "fraction": Double(fraction), "done": done, "error": error])
    }
}

extension PermissionsChangedEvent {
    init(kind: PermissionName, status: PermissionStatusName) {
        self = Wire.make(["kind": kind.rawValue, "status": status.rawValue])
    }
}

extension LogEvent {
    init(level: String, message: String) {
        self = Wire.make(["level": level, "message": message])
    }
}

extension FatalEvent {
    init(message: String) {
        self = Wire.make(["message": message])
    }
}

// MARK: - Ficheros de salida

extension AsrWordWire {
    init(startMs: UInt64, endMs: UInt64, text: String) {
        self = Wire.make(["start_ms": startMs, "end_ms": endMs, "text": text])
    }
}

extension AsrSegmentWire {
    init(startMs: UInt64, endMs: UInt64, text: String, confidence: Float?, words: [AsrWordWire]) {
        self = Wire.make([
            "start_ms": startMs, "end_ms": endMs, "text": text,
            "confidence": confidence.map { Double($0) }, "words": words.map(Wire.json),
        ])
    }
}

extension AsrFile {
    init(model: String, language: String?, durationMs: UInt64, segments: [AsrSegmentWire]) {
        self = Wire.make([
            "model": model, "language": language, "duration_ms": durationMs, "segments": segments.map(Wire.json),
        ])
    }
}

extension DiarizationTurnWire {
    init(label: String, startMs: UInt64, endMs: UInt64) {
        self = Wire.make(["label": label, "start_ms": startMs, "end_ms": endMs])
    }
}

extension DiarizedSpeakerWire {
    init(label: String, embedding: [Float], totalMs: UInt64) {
        self = Wire.make(["label": label, "embedding": embedding.map { Double($0) }, "total_ms": totalMs])
    }
}

extension DiarizationFile {
    init(embeddingModel: String, turns: [DiarizationTurnWire], speakers: [DiarizedSpeakerWire]) {
        self = Wire.make([
            "embedding_model": embeddingModel, "turns": turns.map(Wire.json), "speakers": speakers.map(Wire.json),
        ])
    }
}

/// Escritura atómica: `<path>.tmp` → fsync → rename.
enum AtomicFile {
    static func write(_ data: Data, to url: URL) throws {
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let tmp = url.appendingPathExtension("tmp")
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        let handle = try FileHandle(forWritingTo: tmp)
        do {
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
        } catch {
            try? handle.close()
            try? FileManager.default.removeItem(at: tmp)
            throw error
        }
        if rename(tmp.path, url.path) != 0 {
            let code = errno
            try? FileManager.default.removeItem(at: tmp)
            throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
        }
    }

    static func writeJSON(_ value: some Encodable, to url: URL) throws {
        var data = try ProtocolCoding.encoder().encode(value)
        data.append(0x0A)
        try write(data, to: url)
    }
}
