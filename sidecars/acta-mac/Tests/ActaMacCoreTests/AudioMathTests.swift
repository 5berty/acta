import ActaMacProtocol
import CoreAudio
import Foundation
import Testing
@testable import ActaMacCore

// MARK: - Downmix

private func withBufferList(_ buffers: [[Float]], channelsPerBuffer: Int, _ body: (UnsafePointer<AudioBufferList>) -> Void) {
    let abl = AudioBufferList.allocate(maximumBuffers: buffers.count)
    defer { free(abl.unsafeMutablePointer) }
    var storages: [UnsafeMutablePointer<Float>] = []
    for (i, b) in buffers.enumerated() {
        let p = UnsafeMutablePointer<Float>.allocate(capacity: b.count)
        p.initialize(from: b, count: b.count)
        storages.append(p)
        abl[i] = AudioBuffer(mNumberChannels: UInt32(channelsPerBuffer), mDataByteSize: UInt32(b.count * 4), mData: p)
    }
    body(UnsafePointer(abl.unsafePointer))
    storages.forEach { $0.deallocate() }
}

@Test func `downmix averages interleaved stereo`() {
    var out = [Float](repeating: 9, count: 8)
    withBufferList([[1, 3, -1, -3, 0.5, 0.5]], channelsPerBuffer: 2) { abl in
        let n = out.withUnsafeMutableBufferPointer { Downmix.mono(abl, into: $0.baseAddress!, capacity: 8) }
        #expect(n == 3)
    }
    #expect(Array(out.prefix(3)) == [2, -2, 0.5])
}

@Test func `downmix averages non interleaved buffers`() {
    var out = [Float](repeating: 0, count: 4)
    withBufferList([[1, 1], [3, -1]], channelsPerBuffer: 1) { abl in
        let n = out.withUnsafeMutableBufferPointer { Downmix.mono(abl, into: $0.baseAddress!, capacity: 4) }
        #expect(n == 2)
    }
    #expect(Array(out.prefix(2)) == [2, 0])
}

// MARK: - Ring

@Test func `ring returns written samples with host time of first sample`() {
    let ring = SampleRing(capacity: 100, sampleRate: 1000) // 1 sample = 1000 µs
    let a: [Float] = [1, 2, 3, 4]
    a.withUnsafeBufferPointer { ring.write($0.baseAddress!, count: 4, hostUs: 10_000) }
    let b: [Float] = [5, 6]
    b.withUnsafeBufferPointer { ring.write($0.baseAddress!, count: 2, hostUs: 14_000) }
    let c = ring.read(max: 3)
    #expect(c?.samples == [1, 2, 3])
    #expect(c?.firstHostUs == 10_000)
    let d = ring.read(max: 10)
    #expect(d?.samples == [4, 5, 6])
    #expect(d?.firstHostUs == 13_000)
    #expect(ring.read(max: 10) == nil)
}

@Test func `ring overflow drops oldest and reports it`() {
    let ring = SampleRing(capacity: 4, sampleRate: 1000)
    let a: [Float] = [1, 2, 3, 4, 5, 6]
    a.withUnsafeBufferPointer { ring.write($0.baseAddress!, count: 6, hostUs: 0) }
    let c = ring.read(max: 10)
    #expect(c?.samples == [3, 4, 5, 6])
    #expect(c?.dropped == 2)
    #expect(c?.firstHostUs == 2_000)
}

// MARK: - Frames

@Test func `assembler emits 100 ms frames with continuous pts and seq`() {
    var a = FrameAssembler(sampleRate: 16_000, frameMs: 100)
    var frames = a.push([Float](repeating: 0.5, count: 1000), hostPtsUs: 0)
    #expect(frames.isEmpty)
    frames = a.push([Float](repeating: 0.5, count: 2500), hostPtsUs: 62_500)
    #expect(frames.count == 2)
    #expect(frames.map(\.seq) == [0, 1])
    #expect(frames.map(\.ptsUs) == [0, 100_000])
    #expect(frames[0].samples.count == 1600)
    #expect(frames[0].samples[0] == 16384)
    let tail = a.flush()
    #expect(tail?.samples.count == 300)
    #expect(tail?.ptsUs == 200_000)
    #expect(tail?.seq == 2)
}

@Test func `assembler reanchors when host clock drifts`() {
    var a = FrameAssembler(sampleRate: 16_000, frameMs: 100)
    _ = a.push([Float](repeating: 0, count: 800), hostPtsUs: 0)
    // Debería llegar a 50 ms; llega a 500 ms (hueco): cierra parcial y re-ancla.
    let frames = a.push([Float](repeating: 0, count: 1600), hostPtsUs: 500_000)
    #expect(frames.count == 2)
    #expect(frames[0].ptsUs == 0)
    #expect(frames[0].samples.count == 800)
    #expect(frames[1].ptsUs == 500_000)
    #expect(frames[1].samples.count == 1600)
}

@Test func `small jitter does not reanchor`() {
    var a = FrameAssembler(sampleRate: 16_000, frameMs: 100)
    _ = a.push([Float](repeating: 0, count: 800), hostPtsUs: 0)
    let frames = a.push([Float](repeating: 0, count: 800), hostPtsUs: 60_000) // +10 ms
    #expect(frames.count == 1)
    #expect(frames[0].ptsUs == 0)
    #expect(frames[0].samples.count == 1600)
}

@Test func `discard drops pending and next push reanchors`() {
    var a = FrameAssembler(sampleRate: 16_000, frameMs: 100)
    _ = a.push([Float](repeating: 0, count: 800), hostPtsUs: 0)
    a.discard()
    let flushed = a.flush()
    #expect(flushed == nil)
    let f = a.push([Float](repeating: 0, count: 1600), hostPtsUs: 9_000_000)
    #expect(f.first?.ptsUs == 9_000_000)
}

@Test func `s16 conversion clips and rounds`() {
    #expect(Pcm.s16(2) == 32767)
    #expect(Pcm.s16(-2) == -32767)
    #expect(Pcm.s16(0) == 0)
    #expect(Pcm.s16(.nan) == 0)
}

@Test func `frame base64 is little endian s16`() {
    let f = PcmFrame(seq: 0, ptsUs: 0, samples: [1, -2])
    #expect(f.base64 == "AQD+/w==")
}

@Test func `zero watch flags sustained exact zeros and clears on signal`() {
    var z = ZeroWatch(seconds: 1, sampleRate: 1000)
    do { let r = z.observe([Int16](repeating: 0, count: 600)); #expect(r == nil) }
    do { let r = z.observe([Int16](repeating: 0, count: 600)); #expect(r == true) }
    do { let r = z.observe([Int16](repeating: 0, count: 600)); #expect(r == nil) }
    do { let r = z.observe([0, 0, 1]); #expect(r == false) }
    do { let r = z.observe([1]); #expect(r == nil) }
}

@Test func `resampler keeps a bounded latency and never drifts`() {
    // Trozos de 20 ms (lo que lee la tarea de drenado) y trozos grandes: el
    // déficit es búfer interno del convertidor (acotado), nunca pérdida acumulada.
    for (calls, size, maxDeficit) in [(100, 960, 64), (1000, 960, 64), (10, 4800, 600), (100, 4800, 600)] {
        let r = MonoResampler(inRate: 48_000)
        var total = 0
        for i in 0..<calls {
            let chunk = (0..<size).map { Float(sin(Double(i * size + $0) * 2 * .pi * 440 / 48_000)) * 0.5 }
            total += r.process(chunk).count
        }
        let deficit = calls * size / 3 - total
        #expect(deficit >= 0 && deficit < maxDeficit, "calls=\(calls) size=\(size) deficit=\(deficit)")
    }
}

@Test func `resampler passes through at 16 kHz`() {
    let r = MonoResampler(inRate: 16_000)
    #expect(r.process([0.1, 0.2]) == [0.1, 0.2])
}

