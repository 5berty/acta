import ActaMacProtocol
import AVFoundation
import Foundation
import Testing
@testable import ActaMacCore

/// Recoge lo que el sidecar escribiría en stdout.
final class Lines: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [[String: Any]] = []

    var sink: Output.Sink {
        { [self] data in
            let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            lock.lock()
            items.append(obj)
            lock.unlock()
        }
    }

    var all: [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return items
    }

    func response(_ id: Int) -> [String: Any]? {
        all.first { $0["type"] as? String == "response" && $0["id"] as? Int == id }
    }
}

private func dispatcher(_ lines: Lines) -> Dispatcher {
    let models = FileManager.default.temporaryDirectory.appendingPathComponent("acta-models-\(UUID().uuidString)")
    return Dispatcher(output: Output(sink: lines.sink, onBrokenPipe: {}), modelsBase: models, exit: { _ in })
}

@Test func `unknown command answers unsupported with the same id`() async {
    let lines = Lines()
    await dispatcher(lines).handle(line: #"{"id":9,"cmd":"nope"}"#)
    let r = lines.response(9)
    #expect(r?["ok"] as? Bool == false)
    #expect((r?["error"] as? [String: Any])?["code"] as? String == "unsupported")
}

@Test func `bad args still get an invalid_args reply`() async {
    let lines = Lines()
    await dispatcher(lines).handle(line: #"{"id":3,"cmd":"capture.retarget","args":{"pids":"x"}}"#)
    #expect((lines.response(3)?["error"] as? [String: Any])?["code"] as? String == "invalid_args")
}

@Test func `idle commands succeed without hardware`() async {
    let lines = Lines()
    let d = dispatcher(lines)
    await d.handle(line: #"{"id":1,"cmd":"capture.pause"}"#)
    await d.handle(line: #"{"id":2,"cmd":"capture.stop"}"#)
    await d.handle(line: #"{"id":3,"cmd":"detect.stop"}"#)
    await d.handle(line: #"{"id":4,"cmd":"speakers.unwatch"}"#)
    await d.handle(line: #"{"id":5,"cmd":"screen.stop"}"#)
    await d.handle(line: #"{"id":6,"cmd":"asr.live.stop"}"#)
    for id in 1...6 { #expect(lines.response(id)?["ok"] as? Bool == true, "id \(id)") }
}

@Test func `errors map to protocol codes`() async {
    let lines = Lines()
    let d = dispatcher(lines)
    await d.handle(line: #"{"id":1,"cmd":"job.cancel","args":{"job_id":"nope"}}"#)
    await d.handle(line: #"{"id":2,"cmd":"models.download","args":{"name":"whisper"}}"#)
    await d.handle(line: #"{"id":3,"cmd":"capture.retarget","args":{"pids":[],"bundle_ids":[]}}"#)
    await d.handle(line: #"{"id":4,"cmd":"screen.snapshot","args":{"reason":"manual","at_unix_ms":1,"keyword":null}}"#)
    await d.handle(line: #"{"id":5,"cmd":"asr.transcribe","args":{"job_id":"j","wav_path":"/nope.wav","out_path":"/tmp/x.json","language":null,"model":"parakeet-tdt-0.6b-v3"}}"#)
    await d.handle(line: #"{"id":6,"cmd":"capture.start","args":{"session_id":"s","sample_rate":44100,"frame_ms":100,"mic":{"enabled":true,"device_uid":null},"system":{"enabled":false,"pids":[],"bundle_ids":[]}}}"#)
    func code(_ id: Int) -> String? { (lines.response(id)?["error"] as? [String: Any])?["code"] as? String }
    #expect(code(1) == "not_found")
    #expect(code(2) == "invalid_args")
    #expect(code(3) == "not_found")
    #expect(code(4) == "not_found")
    #expect(code(5) == "not_found")
    #expect(code(6) == "invalid_args")
}

@Test func `short wav transcribes to an empty asr file without loading models`() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("acta-asr-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let wav = dir.appendingPathComponent("mic.wav")
    let fmt = try #require(AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true))
    do {
        let f = try AVAudioFile(forWriting: wav, settings: fmt.settings, commonFormat: .pcmFormatInt16, interleaved: true)
        let buf = try #require(AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 1600))
        buf.frameLength = 1600 // 100 ms
        try f.write(from: buf)
    }
    let out = dir.appendingPathComponent("transcript/asr-mic.json")
    let lines = Lines()
    await dispatcher(lines).handle(line: #"{"id":1,"cmd":"asr.transcribe","args":{"job_id":"j1","wav_path":"\#(wav.path)","out_path":"\#(out.path)","language":"es","model":"parakeet-tdt-0.6b-v3"}}"#)
    let r = try #require(lines.response(1))
    #expect(r["ok"] as? Bool == true)
    #expect((r["result"] as? [String: Any])?["segments"] as? Int == 0)
    let file = try ProtocolCoding.decoder().decode(AsrFile.self, from: Data(contentsOf: out))
    #expect(file.segments.isEmpty)
    #expect(file.durationMs == 100)
    let progress = lines.all.filter { $0["event"] as? String == "job.progress" }
    #expect(progress.count >= 2)
}

@Test func `capabilities advertise the process tap on 14_2 plus`() {
    #expect(Dispatcher.capabilities.contains("process_tap"))
    #expect(Dispatcher.capabilities.contains("asr"))
}

// MARK: - Jobs

@Test func `job returns its value`() async throws {
    let jobs = JobRegistry()
    let v = try await jobs.run("a") { 42 }
    #expect(v == 42)
    #expect(await jobs.running == 0)
}

@Test func `cancel answers immediately even if the work ignores cancellation`() async {
    let jobs = JobRegistry()
    let started = Date()
    async let result: Int = jobs.run("slow") {
        // Trabajo que NO mira la cancelación (como una librería ajena).
        usleep(1_500_000)
        return 1
    }
    try? await Task.sleep(for: .milliseconds(100))
    #expect(await jobs.cancel("slow"))
    do {
        _ = try await result
        Issue.record("expected cancellation")
    } catch let e as ProtocolError {
        #expect(e.code == .cancelled)
    } catch {
        Issue.record("unexpected \(error)")
    }
    #expect(Date().timeIntervalSince(started) < 1.0)
}

@Test func `duplicate job id is busy`() async {
    let jobs = JobRegistry()
    async let first: Int = jobs.run("x") {
        try await Task.sleep(for: .milliseconds(300))
        return 1
    }
    try? await Task.sleep(for: .milliseconds(50))
    await #expect(throws: ProtocolError.self) { try await jobs.run("x") { 2 } }
    _ = try? await first
}

// MARK: - Wire + permisos

@Test func `wire builders produce the protocol shape`() throws {
    let enc = ProtocolCoding.encoder()
    func obj(_ e: Event) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: enc.encode(EventLine(ts: 1, event: e))) as? [String: Any])
    }
    let frame = try obj(.audioFrame(AudioFrameEvent(track: .mic, seq: 3, ptsUs: 300_000, sampleRate: 16_000, data: "AA==")))
    let fd = try #require(frame["data"] as? [String: Any])
    #expect(fd["channels"] as? Int == 1 && fd["format"] as? String == "s16le" && fd["pts_us"] as? Int == 300_000)

    let app = AppInfoWire(pid: 1, bundleId: "com.microsoft.teams2", name: "Teams", audioPids: [1, 2])
    let sig = try obj(.detectSignal(DetectSignalEvent(signal: .meetTabOpen, app: app, windowTitle: nil, url: "u")))
    let sd = try #require(sig["data"] as? [String: Any])
    #expect(sd["signal"] as? String == "meet_tab_open")
    #expect((sd["app"] as? [String: Any])?["bundle_id"] as? String == "com.microsoft.teams2")
    #expect(sd["window_title"] == nil || sd["window_title"] is NSNull)

    let roster = SpeakersRosterEvent(pid: 1, participants: [ParticipantWire(name: "Ana", isSelf: false, muted: nil)])
    #expect(roster.participants.first?.name == "Ana")
    let start = CaptureStartResult(startedAtUnixMs: 5, micDevice: nil, systemPids: [3])
    #expect(start.systemPids == [3] && start.micDevice == nil)
    let diar = DiarizationFile(embeddingModel: "m", turns: [DiarizationTurnWire(label: "S1", startMs: 0, endMs: 1)],
                               speakers: [DiarizedSpeakerWire(label: "S1", embedding: [0.25, 0.5], totalMs: 1)])
    #expect(diar.speakers[0].embedding == [0.25, 0.5])
    let perms = PermissionsStatusResult(permissions: [PermissionEntry(kind: .automation, status: .notDetermined, target: "com.apple.Safari")])
    #expect(perms.permissions[0].target == "com.apple.Safari")
    #expect(ModelsProgressEvent(name: "asr", fraction: 0.5, done: false, error: nil).fraction == 0.5)
    #expect(ScreenSnapshotResult(frame: nil).frame == nil)
}

@Test func `permission code mapping`() {
    #expect(PermissionMapping.tccPreflight(0) == .granted)
    #expect(PermissionMapping.tccPreflight(1) == .denied)
    #expect(PermissionMapping.tccPreflight(2) == .notDetermined)
    #expect(PermissionMapping.appleEvents(noErr) == .granted)
    #expect(PermissionMapping.appleEvents(OSStatus(errAEEventNotPermitted)) == .denied)
    #expect(PermissionMapping.appleEvents(OSStatus(errAEEventWouldRequireUserConsent)) == .notDetermined)
    #expect(PermissionMapping.appleEvents(-600) == .unknown)
}

@Test func `permission diff reports only changes`() {
    let old: [String: PermissionStatusName] = ["microphone|": .notDetermined, "accessibility|": .granted]
    let new: [String: PermissionStatusName] = ["microphone|": .granted, "accessibility|": .granted]
    #expect(PermissionDiff.changes(old: old, new: new) == [.init(kind: .microphone, status: .granted)])
}

@Test func `output drops lines over 1 MiB instead of breaking the protocol`() async {
    let lines = Lines()
    let out = Output(sink: lines.sink, onBrokenPipe: {})
    await out.log("info", String(repeating: "a", count: 1_100_000))
    await out.log("info", "ok")
    #expect(lines.all.count == 1)
}
