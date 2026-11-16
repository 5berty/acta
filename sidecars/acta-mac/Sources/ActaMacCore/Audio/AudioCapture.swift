// capture.* — dos pistas separadas (mic = "Yo", system = los demás), 16 kHz
// mono s16, frames de 100 ms con pts en el reloj host común.
//
// - Cambio de salida por defecto (AirPods): se rehace el tap (el agregado usa
//   la salida como reloj) → audio.device_changed(system, default_output_changed).
// - Cambio de entrada por defecto (si el mic sigue al de por defecto) o
//   dispositivo desconectado → se rehace el IOProc del mic.
// - Teams lanza helpers: si hay bundle_ids/pids objetivo, al cambiar la lista
//   de procesos de la HAL se re-resuelven y se rehace el tap si cambió el set.

import ActaMacProtocol
import AVFoundation
import CoreAudio
import Foundation

/// Una pista: fuente HAL → ring → remuestreo → frames → stdout.
actor TrackPipeline {
    let track: TrackName
    private let output: Output
    private let startHostUs: UInt64
    private let frameMs: Int
    private var source: HALInput?
    private var resampler: MonoResampler?
    private var assembler: FrameAssembler
    private var zero = ZeroWatch(seconds: 10)
    private var paused = false
    private var lastData = Date()
    private var stalled = false
    private var drain: Task<Void, Never>?
    private var liveSink: (@Sendable ([Float]) -> Void)?
    private let expectSignal: @Sendable () -> Bool
    private let zeroHint: @Sendable () -> PermissionsChangedEvent?

    init(
        track: TrackName, output: Output, startHostUs: UInt64, frameMs: Int,
        expectSignal: @escaping @Sendable () -> Bool,
        zeroHint: @escaping @Sendable () -> PermissionsChangedEvent?
    ) {
        self.track = track
        self.output = output
        self.startHostUs = startHostUs
        self.frameMs = frameMs
        self.expectSignal = expectSignal
        self.zeroHint = zeroHint
        assembler = FrameAssembler(sampleRate: 16_000, frameMs: frameMs)
    }

    func attach(_ input: HALInput) async {
        await flushPartial()
        source = input
        resampler = MonoResampler(inRate: input.sampleRate)
        lastData = Date()
        if drain == nil {
            drain = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(20))
                    await self?.drainOnce()
                }
            }
        }
    }

    func detach() async {
        await drainOnce()
        await flushPartial()
        source = nil
    }

    func setPaused(_ p: Bool) {
        paused = p
        if p { assembler.discard() }
    }

    func setLiveSink(_ sink: (@Sendable ([Float]) -> Void)?) { liveSink = sink }

    func stop() async {
        drain?.cancel()
        drain = nil
        await detach()
    }

    private func flushPartial() async {
        guard !paused, let f = assembler.flush() else { return }
        await emit(f)
    }

    private func drainOnce() async {
        guard let src = source else { return }
        var got = false
        while let chunk = src.ring.read(max: Int(src.sampleRate / 2)) {
            got = got || !chunk.samples.isEmpty
            if chunk.dropped > 0 {
                let perFrame = max(1.0, src.sampleRate * Double(frameMs) / 1000)
                let frames = UInt64((Double(chunk.dropped) / perFrame).rounded(.up))
                await output.emit(.audioOverrun(AudioOverrunEvent(track: track, droppedFrames: frames)))
            }
            if chunk.samples.isEmpty { continue }
            if paused { continue }
            let mono16k = resampler?.process(chunk.samples) ?? chunk.samples
            if mono16k.isEmpty { continue }
            liveSink?(mono16k)
            let pts = chunk.firstHostUs > startHostUs ? chunk.firstHostUs - startHostUs : 0
            for f in assembler.push(mono16k, hostPtsUs: pts) {
                await emit(f)
            }
        }
        if got {
            lastData = Date()
            if stalled {
                stalled = false
                await output.emit(.audioTrackState(AudioTrackStateEvent(track: track, state: .running, message: nil)))
            }
        } else if !paused, !stalled, Date().timeIntervalSince(lastData) > 3 {
            stalled = true
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: track, state: .stalled, message: "no audio from device for 3 s")))
        }
    }

    private func emit(_ f: PcmFrame) async {
        await output.emit(.audioFrame(AudioFrameEvent(track: track, seq: f.seq, ptsUs: f.ptsUs, sampleRate: 16_000, data: f.base64)))
        switch zero.observe(f.samples) {
        case true?:
            if expectSignal() {
                await output.log("warn", "\(track.rawValue): only exact zeros for 10 s (TCC permission denied?)")
                if let hint = zeroHint() { await output.emit(.permissionsChanged(hint)) }
            }
        case false?:
            await output.log("info", "\(track.rawValue): signal back after exact zeros")
        case nil:
            break
        }
    }
}

public actor CaptureService {
    private let output: Output
    private let listenerQueue = DispatchQueue(label: "acta.audio.listeners")

    private var args: CaptureStartArgs?
    private var startHostUs: UInt64 = 0
    private var mic: TrackPipeline?
    private var system: TrackPipeline?
    private var micInput: HALInput?
    private var micListeners: [PropertyListener] = []
    private var tap: AnyObject?
    private var tapObjects: Set<AudioObjectID> = []
    private var tapPids: [Int32] = []
    private var systemListeners: [PropertyListener] = []
    private var rebuildingSystem = false
    private var liveSink: (@Sendable (TrackName, [Float]) -> Void)?

    public init(output: Output) { self.output = output }

    public var isCapturing: Bool { args != nil }

    // MARK: Comandos

    public func start(_ a: CaptureStartArgs) async throws -> CaptureStartResult {
        if args != nil { throw ProtocolError(code: .busy, message: "capture already running") }
        guard a.sampleRate == 16_000 else { throw ProtocolError(code: .invalidArgs, message: "sample_rate must be 16000") }
        guard a.frameMs > 0, a.frameMs <= 1000 else { throw ProtocolError(code: .invalidArgs, message: "bad frame_ms") }
        guard a.mic.enabled || a.system.enabled else { throw ProtocolError(code: .invalidArgs, message: "no track enabled") }
        if a.mic.enabled, PermissionProbe.microphone() == .denied {
            throw ProtocolError(code: .permissionDenied, message: "microphone permission denied")
        }
        if a.system.enabled {
            guard #available(macOS 14.2, *) else {
                throw ProtocolError(code: .unsupported, message: "process taps need macOS 14.2+")
            }
            if PermissionProbe.systemAudio() == .denied {
                throw ProtocolError(code: .permissionDenied, message: "system audio capture permission denied")
            }
        }
        let host = HostClock.nowHost()
        let startUnix = Clock.unixMs()
        startHostUs = HostClock.micros(host)
        args = a
        var micName: String?
        var errors: [String] = []

        if a.mic.enabled {
            mic = makePipeline(.mic)
            do {
                micName = try await buildMic(reason: nil)
            } catch {
                errors.append("mic: \(error)")
                await output.emit(.audioTrackState(AudioTrackStateEvent(track: .mic, state: .failed, message: "\(error)")))
            }
        }
        if a.system.enabled {
            system = makePipeline(.system)
            do {
                try await buildSystem(reason: nil)
            } catch {
                errors.append("system: \(error)")
                await output.emit(.audioTrackState(AudioTrackStateEvent(track: .system, state: .failed, message: "\(error)")))
            }
            installSystemListeners()
        }
        let micOK = !a.mic.enabled || micInput != nil
        let sysOK = !a.system.enabled || tap != nil || !tapObjects.isEmpty || isWaitingForTargets
        if !micOK && !sysOK {
            await stop()
            throw ProtocolError(code: .internalError, message: errors.joined(separator: "; "))
        }
        return CaptureStartResult(startedAtUnixMs: startUnix, micDevice: micName, systemPids: tapPids)
    }

    public func pause() async {
        await mic?.setPaused(true)
        await system?.setPaused(true)
    }

    public func resume() async {
        await mic?.setPaused(false)
        await system?.setPaused(false)
    }

    public func stop() async {
        micListeners = []
        systemListeners = []
        if let m = mic { await m.stop() }
        if let s = system { await s.stop() }
        micInput?.stop()
        micInput = nil
        stopTap()
        if args?.mic.enabled == true {
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: .mic, state: .stopped, message: nil)))
        }
        if args?.system.enabled == true {
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: .system, state: .stopped, message: nil)))
        }
        mic = nil
        system = nil
        args = nil
        tapObjects = []
        tapPids = []
    }

    public func retarget(_ r: CaptureRetargetArgs) async throws {
        guard var a = args else { throw ProtocolError(code: .notFound, message: "no capture running") }
        a.system.pids = r.pids
        a.system.bundleIds = r.bundleIds
        args = a
        guard a.system.enabled else { return }
        try await buildSystem(reason: nil, force: true)
    }

    /// Alimenta la previsualización en vivo con el audio de 16 kHz.
    public func setLiveSink(_ sink: (@Sendable (TrackName, [Float]) -> Void)?) async {
        liveSink = sink
        if let m = mic { await m.setLiveSink(Self.bind(sink, .mic)) }
        if let sy = system { await sy.setLiveSink(Self.bind(sink, .system)) }
    }

    // MARK: Mic

    private func makePipeline(_ track: TrackName) -> TrackPipeline {
        let expect: @Sendable () -> Bool
        let hint: @Sendable () -> PermissionsChangedEvent?
        switch track {
        case .mic:
            expect = { true }
            hint = { PermissionProbe.microphone() == .denied ? PermissionsChangedEvent(kind: .microphone, status: .denied) : nil }
        case .system:
            let objects: @Sendable () -> Set<AudioObjectID> = { [weak self] in
                // Lectura best-effort sin aislar: solo para un aviso.
                self?.unsafeTapObjects ?? []
            }
            expect = {
                let objs = objects()
                if objs.isEmpty { return CA.audioProcesses().contains { $0.runningOutput } }
                return objs.contains { CA.audioProcess($0)?.runningOutput == true }
            }
            hint = { PermissionProbe.systemAudio() == .denied ? PermissionsChangedEvent(kind: .systemAudio, status: .denied) : nil }
        }
        let p = TrackPipeline(track: track, output: output, startHostUs: startHostUs, frameMs: Int(args?.frameMs ?? 100), expectSignal: expect, zeroHint: hint)
        if let sink = liveSink {
            Task { await p.setLiveSink({ sink(track, $0) }) }
        }
        return p
    }

    private static func bind(_ sink: (@Sendable (TrackName, [Float]) -> Void)?, _ track: TrackName) -> (@Sendable ([Float]) -> Void)? {
        guard let sink else { return nil }
        return { sink(track, $0) }
    }

    nonisolated(unsafe) private var unsafeTapObjects: Set<AudioObjectID> = []

    private func buildMic(reason: String?) async throws -> String? {
        guard let a = args, let pipeline = mic else { return nil }
        var device: AudioObjectID?
        if let uid = a.mic.deviceUid {
            device = CA.device(uid: uid)
            if device == nil { Log.warn("mic \(uid) not found; using default input") }
        }
        if device == nil { device = CA.defaultDevice(input: true) }
        guard let dev = device, CA.channelCount(dev, input: true) > 0 else {
            throw ProtocolError(code: .notFound, message: "no input device")
        }
        guard HALInput.inputIsFloat(dev) else {
            throw ProtocolError(code: .unsupported, message: "input device is not Float32")
        }
        micInput?.stop()
        let input = HALInput(device: dev, sampleRate: HALInput.inputSampleRate(dev))
        try input.start()
        micInput = input
        await pipeline.attach(input)
        installMicListeners(device: dev)
        let name = CA.name(dev)
        if let reason {
            await output.emit(.audioDeviceChanged(AudioDeviceChangedEvent(track: .mic, deviceUid: CA.uid(dev), deviceName: name, reason: reason)))
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: .mic, state: .running, message: nil)))
        }
        return name
    }

    private func installMicListeners(device: AudioObjectID) {
        var ls: [PropertyListener] = []
        if args?.mic.deviceUid == nil,
           let l = PropertyListener(CA.system, kAudioHardwarePropertyDefaultInputDevice, queue: listenerQueue, { [weak self] in
               Task { await self?.micDeviceEvent("default_input_changed") }
           }) {
            ls.append(l)
        }
        if let l = PropertyListener(device, kAudioDevicePropertyDeviceIsAlive, queue: listenerQueue, { [weak self] in
            if !CA.isAlive(device) { Task { await self?.micDeviceEvent("device_removed") } }
        }) {
            ls.append(l)
        }
        micListeners = ls
    }

    private func micDeviceEvent(_ reason: String) async {
        guard args?.mic.enabled == true else { return }
        await output.emit(.audioTrackState(AudioTrackStateEvent(track: .mic, state: .restarting, message: reason)))
        // Dejar que la HAL asiente el cambio (AirPods tardan en exponer el perfil).
        try? await Task.sleep(for: .milliseconds(300))
        do {
            _ = try await buildMic(reason: reason)
        } catch {
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: .mic, state: .failed, message: "\(error)")))
        }
    }

    // MARK: System (process tap)

    private var isWaitingForTargets: Bool {
        guard let a = args else { return false }
        return tap == nil && (!a.system.pids.isEmpty || !a.system.bundleIds.isEmpty)
    }

    /// Objetos de proceso de la HAL para los pids / bundle ids pedidos,
    /// helpers incluidos (por proceso responsable o prefijo de bundle).
    private func resolveTargets(_ s: SystemArgs) -> (objects: Set<AudioObjectID>, pids: [Int32]) {
        var objects = Set<AudioObjectID>()
        var pids = Set<Int32>()
        let procs = CA.audioProcesses()
        let owner = LiveOwners.resolve(known: s.bundleIds)
        for p in procs {
            let resp = Responsibility.responsiblePid(p.pid)
            let byPid = s.pids.contains(p.pid) || resp.map { s.pids.contains($0) } == true
            var byBundle = false
            if !s.bundleIds.isEmpty {
                if s.bundleIds.contains(p.bundleId) || AppResolution.ownerByPrefix(p.bundleId, known: s.bundleIds) != nil {
                    byBundle = true
                } else if let o = owner(p), s.bundleIds.contains(o.bundleId) {
                    byBundle = true
                }
            }
            if byPid || byBundle {
                objects.insert(p.objectId)
                pids.insert(p.pid)
            }
        }
        return (objects, pids.sorted())
    }

    private func buildSystem(reason: String?, force: Bool = false) async throws {
        guard #available(macOS 14.2, *) else { return }
        guard let a = args, let pipeline = system else { return }
        if rebuildingSystem { return }
        rebuildingSystem = true
        defer { rebuildingSystem = false }

        let targeted = !a.system.pids.isEmpty || !a.system.bundleIds.isEmpty
        let resolved = targeted ? resolveTargets(a.system) : (objects: Set<AudioObjectID>(), pids: [Int32]())
        if !force, reason == nil, tap != nil, resolved.objects == tapObjects { return }
        if targeted, resolved.objects.isEmpty {
            stopTap()
            await pipeline.detach()
            tapObjects = []
            unsafeTapObjects = []
            tapPids = []
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: .system, state: .restarting, message: "waiting for the target app to open audio")))
            return
        }
        if tap != nil {
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: .system, state: .restarting, message: reason ?? "retarget")))
        }
        await pipeline.detach()
        stopTap()
        let newTap = try SystemTap(processObjects: Array(resolved.objects))
        try newTap.start()
        tap = newTap
        tapObjects = resolved.objects
        unsafeTapObjects = resolved.objects
        tapPids = resolved.pids
        await pipeline.attach(newTap.input)
        if let reason {
            await output.emit(.audioDeviceChanged(AudioDeviceChangedEvent(
                track: .system, deviceUid: newTap.outputDeviceUID, deviceName: newTap.outputDeviceName, reason: reason
            )))
        }
        await output.emit(.audioTrackState(AudioTrackStateEvent(track: .system, state: .running, message: nil)))
    }

    private func stopTap() {
        if #available(macOS 14.2, *), let t = tap as? SystemTap { t.stop() }
        tap = nil
    }

    private func installSystemListeners() {
        var ls: [PropertyListener] = []
        if let l = PropertyListener(CA.system, kAudioHardwarePropertyDefaultOutputDevice, queue: listenerQueue, { [weak self] in
            Task { await self?.systemDeviceEvent("default_output_changed") }
        }) { ls.append(l) }
        if let l = PropertyListener(CA.system, kAudioHardwarePropertyProcessObjectList, queue: listenerQueue, { [weak self] in
            Task { await self?.processListChanged() }
        }) { ls.append(l) }
        systemListeners = ls
    }

    private func systemDeviceEvent(_ reason: String) async {
        guard args?.system.enabled == true else { return }
        try? await Task.sleep(for: .milliseconds(300))
        do {
            try await buildSystem(reason: reason, force: true)
        } catch {
            await output.emit(.audioTrackState(AudioTrackStateEvent(track: .system, state: .failed, message: "\(error)")))
        }
    }

    private var processListPending = false

    private func processListChanged() async {
        guard let a = args, a.system.enabled, !a.system.pids.isEmpty || !a.system.bundleIds.isEmpty else { return }
        if processListPending { return }
        processListPending = true
        try? await Task.sleep(for: .milliseconds(500))
        processListPending = false
        do {
            try await buildSystem(reason: nil)
        } catch {
            await output.log("warn", "system tap rebuild after process change failed: \(error)")
        }
    }
}

// MARK: - devices.list / apps.list

public enum AudioInventory {
    public static func devices() -> DevicesListResult {
        let defIn = CA.defaultDevice(input: true)
        let defOut = CA.defaultDevice(input: false)
        var inputs: [DeviceWire] = []
        var outputs: [DeviceWire] = []
        for d in CA.allDevices() {
            guard let uid = CA.uid(d) else { continue }
            let name = CA.name(d) ?? uid
            let transport = CA.transport(d)
            if CA.channelCount(d, input: true) > 0 {
                inputs.append(DeviceWire(uid: uid, name: name, isDefault: d == defIn, transport: transport))
            }
            if CA.channelCount(d, input: false) > 0 {
                outputs.append(DeviceWire(uid: uid, name: name, isDefault: d == defOut, transport: transport))
            }
        }
        return DevicesListResult(inputs: inputs, outputs: outputs)
    }

    public static func apps() -> AppsListResult {
        let apps = LiveOwners.apps(known: [])
        return AppsListResult(apps: apps.values.sorted { $0.name < $1.name }.map {
            AppInfoWire(pid: $0.mainPid, bundleId: $0.bundleId, name: $0.name, audioPids: $0.audioPids)
        })
    }
}
