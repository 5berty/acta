// Lógica pura del audio: sin hardware, todo testeable.
//
//   IOProc (hilo de tiempo real)       tarea de drenado (cada 20 ms)
//   ───────────────────────────        ────────────────────────────────────
//   Downmix.mono → SampleRing.write ─▶ SampleRing.read → MonoResampler (16 kHz)
//   (sin reservas de memoria,            → FrameAssembler (100 ms, s16, pts)
//    lock corto, descarta lo viejo)       → audio.frame por Output

import AVFoundation
import CoreAudio
import Foundation
import os

// MARK: - Downmix

enum Downmix {
    /// Mezcla a mono todas las canales de un AudioBufferList Float32
    /// (entrelazado o no). Devuelve los frames escritos en `out`.
    static func mono(_ abl: UnsafePointer<AudioBufferList>, into out: UnsafeMutablePointer<Float>, capacity: Int) -> Int {
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: abl))
        var frames = Int.max
        var totalChannels = 0
        for b in buffers where b.mData != nil && b.mNumberChannels > 0 {
            let ch = Int(b.mNumberChannels)
            frames = min(frames, Int(b.mDataByteSize) / (MemoryLayout<Float>.size * ch))
            totalChannels += ch
        }
        guard totalChannels > 0, frames != Int.max else { return 0 }
        frames = min(frames, capacity)
        out.update(repeating: 0, count: frames)
        for b in buffers where b.mData != nil && b.mNumberChannels > 0 {
            let ch = Int(b.mNumberChannels)
            let src = b.mData!.assumingMemoryBound(to: Float.self)
            for f in 0..<frames {
                var acc: Float = 0
                for c in 0..<ch { acc += src[f * ch + c] }
                out[f] += acc
            }
        }
        let scale = 1 / Float(totalChannels)
        for f in 0..<frames { out[f] *= scale }
        return frames
    }
}

// MARK: - Ring buffer

/// Ring de samples mono para un solo productor (IOProc) y un consumidor.
/// Si se llena descarta lo más antiguo y lo cuenta (→ `audio.overrun`).
/// Lleva índices absolutos y una marca de hora host para fechar lo leído.
final class SampleRing: @unchecked Sendable {
    struct Chunk: Equatable {
        var samples: [Float]
        /// Hora host (µs) del primer sample leído.
        var firstHostUs: UInt64
        /// Samples descartados por desbordamiento desde la última lectura.
        var dropped: UInt64
    }

    let capacity: Int
    /// Solo sirve para fechar lo leído; se corrige si el dispositivo entrega
    /// a otra frecuencia de la anunciada (ver `RateEstimator`).
    private(set) var sampleRate: Double
    private let storage: UnsafeMutablePointer<Float>
    private let lock = OSAllocatedUnfairLock()
    private var writeAbs: UInt64 = 0
    private var readAbs: UInt64 = 0
    private var droppedPending: UInt64 = 0
    private var markerAbs: UInt64 = 0
    private var markerHostUs: UInt64 = 0

    init(capacity: Int, sampleRate: Double) {
        self.capacity = max(capacity, 1)
        self.sampleRate = sampleRate
        storage = .allocate(capacity: self.capacity)
        storage.initialize(repeating: 0, count: self.capacity)
    }

    deinit { storage.deallocate() }

    func setSampleRate(_ rate: Double) {
        guard rate > 0 else { return }
        lock.withLockUnchecked { sampleRate = rate }
    }

    /// Hilo de tiempo real: sin reservas de memoria.
    func write(_ src: UnsafePointer<Float>, count: Int, hostUs: UInt64) {
        guard count > 0 else { return }
        lock.withLockUnchecked {
            markerAbs = writeAbs
            markerHostUs = hostUs
            var i = 0
            while i < count {
                let pos = Int(writeAbs % UInt64(capacity))
                let n = min(count - i, capacity - pos)
                (storage + pos).update(from: src + i, count: n)
                writeAbs += UInt64(n)
                i += n
            }
            let used = writeAbs - readAbs
            if used > UInt64(capacity) {
                let drop = used - UInt64(capacity)
                readAbs += drop
                droppedPending += drop
            }
        }
    }

    func read(max maxCount: Int) -> Chunk? {
        lock.withLockUnchecked {
            let avail = Int(writeAbs - readAbs)
            guard avail > 0 || droppedPending > 0 else { return nil }
            let n = min(avail, maxCount)
            var out = [Float](repeating: 0, count: n)
            out.withUnsafeMutableBufferPointer { dst in
                var i = 0
                while i < n {
                    let pos = Int((readAbs + UInt64(i)) % UInt64(capacity))
                    let k = min(n - i, capacity - pos)
                    (dst.baseAddress! + i).update(from: storage + pos, count: k)
                    i += k
                }
            }
            let usPerSample = 1_000_000 / sampleRate
            let host: UInt64
            if readAbs <= markerAbs {
                let back = UInt64((Double(markerAbs - readAbs) * usPerSample).rounded())
                host = markerHostUs > back ? markerHostUs - back : 0
            } else {
                host = markerHostUs + UInt64((Double(readAbs - markerAbs) * usPerSample).rounded())
            }
            readAbs += UInt64(n)
            let dropped = droppedPending
            droppedPending = 0
            return Chunk(samples: out, firstHostUs: host, dropped: dropped)
        }
    }
}

// MARK: - Frames de 100 ms

struct PcmFrame: Equatable, Sendable {
    var seq: UInt64
    var ptsUs: UInt64
    var samples: [Int16]

    var base64: String {
        samples.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString()
    }
}

enum Pcm {
    static func s16(_ x: Float) -> Int16 {
        let c = max(-1, min(1, x.isFinite ? x : 0))
        return Int16((c * 32767).rounded())
    }
}

/// Junta samples mono de 16 kHz en frames fijos con `pts` en el reloj host
/// común. Si el reloj del dispositivo se desvía del host más de `maxDriftUs`
/// (deriva de cristal, hueco, cambio de dispositivo), cierra el frame parcial
/// y re-ancla: el writer de Rust rellena o recorta por `pts`.
struct FrameAssembler {
    let sampleRate: Int
    let frameSamples: Int
    var maxDriftUs: Int64 = 40_000
    private(set) var seq: UInt64 = 0
    private var anchorUs: UInt64?
    private var pending: [Float] = []

    init(sampleRate: Int = 16_000, frameMs: Int = 100) {
        self.sampleRate = sampleRate
        frameSamples = max(1, sampleRate * frameMs / 1000)
    }

    private func duration(_ n: Int) -> UInt64 { UInt64(n) * 1_000_000 / UInt64(sampleRate) }

    /// `hostPtsUs`: pts (µs desde capture.start) del primer sample de `samples`.
    mutating func push(_ samples: [Float], hostPtsUs: UInt64) -> [PcmFrame] {
        var out: [PcmFrame] = []
        if let anchor = anchorUs {
            let expected = anchor + duration(pending.count)
            let drift = Int64(bitPattern: hostPtsUs &- expected)
            if abs(drift) > maxDriftUs {
                if let f = flush() { out.append(f) }
                anchorUs = hostPtsUs
            }
        } else {
            anchorUs = hostPtsUs
        }
        pending.append(contentsOf: samples)
        while pending.count >= frameSamples {
            out.append(take(frameSamples))
        }
        return out
    }

    /// Cierra el frame parcial (si lo hay). El siguiente `push` re-ancla.
    mutating func flush() -> PcmFrame? {
        defer { anchorUs = nil }
        guard !pending.isEmpty else { return nil }
        return take(pending.count)
    }

    /// Olvida lo pendiente sin emitir (pausa).
    mutating func discard() {
        pending.removeAll(keepingCapacity: true)
        anchorUs = nil
    }

    private mutating func take(_ n: Int) -> PcmFrame {
        let pts = anchorUs ?? 0
        let samples = pending.prefix(n).map(Pcm.s16)
        pending.removeFirst(n)
        anchorUs = pts + duration(n)
        defer { seq += 1 }
        return PcmFrame(seq: seq, ptsUs: pts, samples: samples)
    }
}

// MARK: - Remuestreo

/// Remuestreo mono Float32 → 16 kHz en streaming (conserva el estado del
/// filtro entre llamadas). Con la misma frecuencia, pasa tal cual.
final class MonoResampler {
    let inRate: Double
    let outRate: Double
    private let converter: AVAudioConverter?
    private let inFormat: AVAudioFormat?
    private let outFormat: AVAudioFormat?

    init(inRate: Double, outRate: Double = 16_000) {
        self.inRate = inRate
        self.outRate = outRate
        if abs(inRate - outRate) < 0.5 {
            converter = nil
            inFormat = nil
            outFormat = nil
        } else {
            let i = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: inRate, channels: 1, interleaved: false)
            let o = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: outRate, channels: 1, interleaved: false)
            inFormat = i
            outFormat = o
            converter = (i != nil && o != nil) ? AVAudioConverter(from: i!, to: o!) : nil
            converter?.sampleRateConverterQuality = AVAudioQuality.high.rawValue
        }
    }

    func process(_ samples: [Float]) -> [Float] {
        guard let converter, let inFormat, let outFormat else { return samples }
        guard !samples.isEmpty,
              let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(samples.count))
        else { return [] }
        inBuf.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { src in
            inBuf.floatChannelData![0].update(from: src.baseAddress!, count: samples.count)
        }
        let cap = AVAudioFrameCount(Double(samples.count) * outRate / inRate) + 256
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return [] }
        let feed = InputFeed(inBuf)
        var error: NSError?
        let status = converter.convert(to: outBuf, error: &error) { _, outStatus in
            if let buf = feed.take() {
                outStatus.pointee = .haveData
                return buf
            }
            outStatus.pointee = .noDataNow
            return nil
        }
        guard status != .error, let data = outBuf.floatChannelData?[0] else {
            Log.warn("resampler: \(error?.localizedDescription ?? "error")")
            return []
        }
        return Array(UnsafeBufferPointer(start: data, count: Int(outBuf.frameLength)))
    }
}

/// Entrega el buffer de entrada una sola vez al bloque del convertidor.
private final class InputFeed: @unchecked Sendable {
    private var buffer: AVAudioPCMBuffer?
    init(_ b: AVAudioPCMBuffer) { buffer = b }
    func take() -> AVAudioPCMBuffer? {
        defer { buffer = nil }
        return buffer
    }
}

// MARK: - Frecuencia real de entrega

/// Mide a qué frecuencia entrega samples el dispositivo de verdad y avisa si
/// no es la que anunció al abrirlo. Pasa con auriculares Bluetooth: al abrir
/// su micro cambian a HFP unos segundos DESPUÉS de crear el agregado del tap,
/// que se queda anunciando 48 kHz mientras entrega 24 kHz. Remuestreado como
/// 48 kHz, el audio sale al doble de velocidad y con un hueco tras cada trozo.
struct RateEstimator {
    static let standard: [Double] = [8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000]

    private(set) var assumed: Double
    var windowUs: UInt64 = 1_000_000
    /// La medida debe caer así de cerca de una frecuencia estándar.
    var tolerance = 0.04
    private var startUs: UInt64?
    private var samples: UInt64 = 0
    private var candidate: Double?

    init(assumed: Double) { self.assumed = assumed }

    /// Apunta un trozo leído del ring. Devuelve la frecuencia corregida cuando
    /// dos ventanas seguidas coinciden en una estándar distinta de la asumida
    /// (un corte suelto del dispositivo no basta).
    mutating func observe(count: Int, firstHostUs: UInt64, dropped: UInt64) -> Double? {
        if dropped > 0 {
            startUs = nil
            candidate = nil
            return nil
        }
        guard count > 0 else { return nil }
        guard let start = startUs, firstHostUs > start else {
            startUs = firstHostUs
            samples = UInt64(count)
            return nil
        }
        let elapsed = firstHostUs - start
        if elapsed < windowUs {
            samples += UInt64(count)
            return nil
        }
        let measured = Double(samples) * 1_000_000 / Double(elapsed)
        startUs = firstHostUs
        samples = UInt64(count)
        guard let snapped = Self.standard.min(by: { abs($0 - measured) < abs($1 - measured) }),
              abs(snapped - measured) <= snapped * tolerance,
              abs(snapped - assumed) > assumed * 0.1
        else {
            candidate = nil
            return nil
        }
        if candidate == snapped {
            candidate = nil
            assumed = snapped
            return snapped
        }
        candidate = snapped
        return nil
    }
}

// MARK: - Silencio digital exacto

/// Detecta "solo ceros exactos" sostenido (firma de TCC denegado en el mic, o
/// de un tap sin permiso mientras la app sí suena).
struct ZeroWatch {
    let thresholdSamples: Int
    private var run = 0
    private(set) var flagged = false

    init(seconds: Double, sampleRate: Int = 16_000) {
        thresholdSamples = Int(seconds * Double(sampleRate))
    }

    /// `true` al entrar en "todo ceros", `false` al salir, `nil` sin cambio.
    mutating func observe(_ samples: [Int16]) -> Bool? {
        if samples.allSatisfy({ $0 == 0 }) {
            run += samples.count
            if !flagged, run >= thresholdSamples {
                flagged = true
                return true
            }
            return nil
        }
        run = 0
        if flagged {
            flagged = false
            return false
        }
        return nil
    }
}

enum HostClock {
    static func nanos(_ hostTime: UInt64) -> UInt64 { AudioConvertHostTimeToNanos(hostTime) }
    static func nowHost() -> UInt64 { AudioGetCurrentHostTime() }
    static func micros(_ hostTime: UInt64) -> UInt64 { nanos(hostTime) / 1000 }
}
