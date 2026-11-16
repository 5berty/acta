// Captura de la HAL: un IOProc sobre un dispositivo (micro físico o el
// agregado privado del process tap). El bloque de E/S solo mezcla a mono y
// escribe en el ring: nada de reservas de memoria, logs ni actores.
//
// Process tap (macOS 14.2+), según AudioCap (insidegui) y recall.ai:
//   CATapDescription → AudioHardwareCreateProcessTap → agregado privado con la
//   salida por defecto como reloj + el tap en kAudioAggregateDeviceTapListKey
//   (auto-start, drift compensation) → IOProc en el agregado.

import AudioToolbox
import CoreAudio
import Foundation

final class HALInput: @unchecked Sendable {
    static let scratchFrames = 16_384

    let device: AudioObjectID
    let sampleRate: Double
    let ring: SampleRing
    private let scratch: UnsafeMutablePointer<Float>
    private let queue = DispatchQueue(label: "acta.audio.io", qos: .userInteractive)
    private var procID: AudioDeviceIOProcID?

    init(device: AudioObjectID, sampleRate: Double, ringSeconds: Double = 10) {
        self.device = device
        self.sampleRate = sampleRate > 0 ? sampleRate : 48_000
        ring = SampleRing(capacity: Int(self.sampleRate * ringSeconds), sampleRate: self.sampleRate)
        scratch = .allocate(capacity: Self.scratchFrames)
        scratch.initialize(repeating: 0, count: Self.scratchFrames)
    }

    deinit {
        stop()
        scratch.deallocate()
    }

    func start() throws {
        var id: AudioDeviceIOProcID?
        let st = AudioDeviceCreateIOProcIDWithBlock(&id, device, queue) { [self] _, input, inputTime, output, _ in
            self.ioCallback(input, inputTime, output)
        }
        try check(st, "AudioDeviceCreateIOProcIDWithBlock")
        procID = id
        try check(AudioDeviceStart(device, id), "AudioDeviceStart")
    }

    func stop() {
        guard let id = procID else { return }
        procID = nil
        AudioDeviceStop(device, id)
        AudioDeviceDestroyIOProcID(device, id)
    }

    private func ioCallback(_ input: UnsafePointer<AudioBufferList>, _ inputTime: UnsafePointer<AudioTimeStamp>, _ output: UnsafeMutablePointer<AudioBufferList>) {
        // Dispositivos dúplex (AirPods): no aportamos nada a la salida.
        for b in UnsafeMutableAudioBufferListPointer(output) where b.mData != nil {
            memset(b.mData, 0, Int(b.mDataByteSize))
        }
        let n = Downmix.mono(input, into: scratch, capacity: Self.scratchFrames)
        guard n > 0 else { return }
        let ts = inputTime.pointee
        let host = ts.mFlags.contains(.hostTimeValid) ? ts.mHostTime : AudioGetCurrentHostTime()
        ring.write(scratch, count: n, hostUs: HostClock.micros(host))
    }

    /// Frecuencia real de la primera stream de entrada (formato virtual).
    static func inputSampleRate(_ device: AudioObjectID) -> Double {
        if let streams = try? CA.getArray(device, kAudioDevicePropertyStreams, kAudioDevicePropertyScopeInput, zero: AudioObjectID(0)),
           let first = streams.first,
           let asbd = try? CA.get(first, kAudioStreamPropertyVirtualFormat, initial: AudioStreamBasicDescription()),
           asbd.mSampleRate > 0 {
            return asbd.mSampleRate
        }
        return CA.nominalSampleRate(device)
    }

    /// El IOProc entrega Float32 (formato virtual por defecto de la HAL).
    static func inputIsFloat(_ device: AudioObjectID) -> Bool {
        guard let streams = try? CA.getArray(device, kAudioDevicePropertyStreams, kAudioDevicePropertyScopeInput, zero: AudioObjectID(0)),
              let first = streams.first,
              let asbd = try? CA.get(first, kAudioStreamPropertyVirtualFormat, initial: AudioStreamBasicDescription())
        else { return true }
        return asbd.mFormatID == kAudioFormatLinearPCM && (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0 && asbd.mBitsPerChannel == 32
    }
}

/// Process tap + agregado privado. Se destruye en orden inverso.
@available(macOS 14.2, *)
final class SystemTap: @unchecked Sendable {
    let input: HALInput
    let outputDeviceUID: String
    let outputDeviceName: String?
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)

    /// `processObjects` vacío = tap global de toda la salida (menos acta).
    init(processObjects: [AudioObjectID]) throws {
        let desc: CATapDescription
        if processObjects.isEmpty {
            let me = CA.processObject(pid: getpid()).map { [$0] } ?? []
            desc = CATapDescription(stereoGlobalTapButExcludeProcesses: me)
        } else {
            desc = CATapDescription(stereoMixdownOfProcesses: processObjects)
        }
        desc.uuid = UUID()
        desc.name = "acta system tap"
        desc.isPrivate = true
        desc.muteBehavior = .unmuted

        var tap = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateProcessTap(desc, &tap), "AudioHardwareCreateProcessTap")
        tapID = tap

        guard let out = CA.defaultDevice(input: false), let outUID = CA.uid(out) else {
            AudioHardwareDestroyProcessTap(tap)
            throw CoreAudioError(status: kAudioHardwareBadDeviceError, what: "default output device")
        }
        outputDeviceUID = outUID
        outputDeviceName = CA.name(out)

        let description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "acta-tap",
            kAudioAggregateDeviceUIDKey: "acta-tap-\(UUID().uuidString)",
            kAudioAggregateDeviceMainSubDeviceKey: outUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapDriftCompensationKey: true,
                kAudioSubTapUIDKey: desc.uuid.uuidString,
            ]],
        ]
        var agg = AudioObjectID(kAudioObjectUnknown)
        let st = AudioHardwareCreateAggregateDevice(description as CFDictionary, &agg)
        guard st == noErr else {
            AudioHardwareDestroyProcessTap(tap)
            throw CoreAudioError(status: st, what: "AudioHardwareCreateAggregateDevice")
        }
        aggregateID = agg

        var rate = HALInput.inputSampleRate(agg)
        if rate <= 0, let asbd = try? CA.get(tap, kAudioTapPropertyFormat, initial: AudioStreamBasicDescription()) {
            rate = asbd.mSampleRate
        }
        input = HALInput(device: agg, sampleRate: rate)
    }

    func start() throws { try input.start() }

    func stop() {
        input.stop()
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    deinit { stop() }
}
