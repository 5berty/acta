import ActaMacProtocol
import Foundation
import Testing
@testable import ActaMacCore

private func tok(_ t: String, _ s: Double, _ e: Double, _ c: Float = 0.9) -> TimedToken {
    TimedToken(text: t, start: s, end: e, confidence: c)
}

@Test func `tokens join into words and punctuation sticks to the previous word`() {
    let words = AsrMapping.words([
        tok(" Ho", 0.0, 0.1), tok("la", 0.1, 0.2), tok(",", 0.2, 0.25),
        tok("▁qué", 0.3, 0.5, 0.5), tok(" tal", 0.5, 0.7), tok("?", 0.7, 0.72),
    ])
    #expect(words.map(\.text) == ["Hola,", "qué", "tal?"])
    #expect(words[0].start == 0 && words[0].end == 0.25)
    #expect(words[1].confidence == 0.5)
}

@Test func `segments split at sentence end and long pauses`() {
    let w = { (t: String, s: Double, e: Double) in TimedWord(text: t, start: s, end: e, confidence: 1) }
    let segs = AsrMapping.segments([
        w("Hola", 0, 0.4), w("a", 0.5, 0.6), w("todos.", 0.6, 1.0),
        w("Empezamos", 1.2, 1.8),
        w("ya", 3.0, 3.2),
    ])
    #expect(segs.map(\.text) == ["Hola a todos.", "Empezamos", "ya"])
    #expect(segs[0].startMs == 0 && segs[0].endMs == 1000)
    #expect(segs[0].words.count == 3)
    #expect(segs[2].startMs == 3000)
}

@Test func `segments never exceed max duration`() {
    let words = (0..<40).map { TimedWord(text: "w\($0)", start: Double($0) * 0.5, end: Double($0) * 0.5 + 0.4, confidence: 1) }
    let segs = AsrMapping.segments(words, maxGap: 0.8, maxDuration: 5)
    #expect(segs.count >= 4)
    #expect(segs.allSatisfy { $0.endMs - $0.startMs <= 5000 })
}

@Test func `fallback segment when there are no token timings`() {
    #expect(AsrMapping.fallbackSegment(text: "  ", duration: 3, confidence: 1).isEmpty)
    let s = AsrMapping.fallbackSegment(text: "hola", duration: 2.5, confidence: 0.8)
    #expect(s.count == 1 && s[0].endMs == 2500)
}

@Test func `embeddings mean is normalized`() {
    let m = Embeddings.meanNormalized([[2, 0], [0, 4]])
    #expect(abs(m[0] - m[1]) < 1e-6)
    #expect(abs(m[0] * m[0] + m[1] * m[1] - 1) < 1e-5)
    #expect(Embeddings.meanNormalized([]).isEmpty)
}

@Test func `diarization file has sorted turns and per speaker totals`() {
    let f = DiarMapping.file([
        DiarSegment(label: "S2", start: 5, end: 7, embedding: [0, 1]),
        DiarSegment(label: "S1", start: 0, end: 2, embedding: [1, 0]),
        DiarSegment(label: "S1", start: 3, end: 4.5, embedding: [1, 0]),
        DiarSegment(label: "S3", start: 8, end: 8, embedding: [1, 1]), // vacío: fuera
    ], database: ["S2": [0, 3]], model: "m")
    #expect(f.turns.map(\.label) == ["S1", "S1", "S2"])
    #expect(f.speakers.map(\.label) == ["S1", "S2"])
    #expect(f.speakers[0].totalMs == 3500)
    #expect(f.speakers[1].embedding == [0, 1], "database embedding, normalized")
    #expect(f.embeddingModel == "m")
}

@Test func `asr file encodes like the rust side expects`() throws {
    let file = AsrFile(model: "parakeet-tdt-0.6b-v3", language: "es", durationMs: 5000, segments: [
        AsrSegmentWire(startMs: 0, endMs: 1200, text: "Hola", confidence: 0.9, words: [AsrWordWire(startMs: 0, endMs: 400, text: "Hola")]),
    ])
    let json = try #require(try JSONSerialization.jsonObject(with: ProtocolCoding.encoder().encode(file)) as? [String: Any])
    #expect(json["duration_ms"] as? Int == 5000)
    let seg = try #require((json["segments"] as? [[String: Any]])?.first)
    #expect(seg["start_ms"] as? Int == 0)
    #expect((seg["words"] as? [[String: Any]])?.first?["text"] as? String == "Hola")
}

@Test func `model paths live under acta models`() {
    let p = ModelPaths(base: URL(fileURLWithPath: "/m/fluidaudio"))
    #expect(p.asr.path == "/m/fluidaudio/parakeet-tdt-0.6b-v3")
    #expect(p.diarizer.path == "/m/fluidaudio/speaker-diarization")
    #expect(ModelPaths.default.base.path.hasSuffix("Library/Application Support/acta/models/fluidaudio"))
}
