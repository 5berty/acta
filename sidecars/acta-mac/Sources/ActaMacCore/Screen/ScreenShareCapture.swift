// screen.* — capturas de la pantalla compartida (opt-in, docs §8).
//
//   SCStream (ventana de la reunión, ≈1 fps, ancho ≤ max_width)
//     → JPEG 0.8 + dHash 64 bits → anillo de `ring_seconds`
//     → cambio de diapositiva: distancia ≥ phash_threshold respecto a la
//       última guardada y estable `stable_frames` frames → captures/
//     → candidata cada `candidate_every_s` mientras se comparte → candidates/
//   ¿Comparte alguien? AX ("X está presentando") y, si AX no dice nada,
//   el propio detector de diapositivas (source "frame").
//   screen.snapshot devuelve el frame más cercano del anillo (sin evento).

import ActaMacProtocol
import CoreGraphics
import CoreImage
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// MARK: - Lógica pura

enum DHash {
    /// dHash 64 bits: miniatura gris 9×8, bit = píxel izquierdo > derecho.
    static func hash(_ image: CGImage) -> UInt64? {
        var px = [UInt8](repeating: 0, count: 9 * 8)
        let ok: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(
                data: buf.baseAddress, width: 9, height: 8, bitsPerComponent: 8, bytesPerRow: 9,
                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: 9, height: 8))
            return true
        }
        return ok ? hash(gray9x8: px) : nil
    }

    static func hash(gray9x8 px: [UInt8]) -> UInt64 {
        precondition(px.count == 72)
        var h: UInt64 = 0
        for y in 0..<8 {
            for x in 0..<8 {
                h <<= 1
                if px[y * 9 + x] > px[y * 9 + x + 1] { h |= 1 }
            }
        }
        return h
    }

    static func distance(_ a: UInt64, _ b: UInt64) -> Int { (a ^ b).nonzeroBitCount }

    static func hex(_ h: UInt64) -> String { String(format: "%016llx", h) }
}

/// Decide cuándo un frame es una diapositiva nueva.
struct SlideChangeDetector {
    let threshold: Int
    let stableFrames: Int
    /// Ruido permitido entre frames "iguales" (compresión, cursor, vídeo pequeño).
    var noise = 3
    private(set) var lastSaved: UInt64?
    private var previous: UInt64?
    private var stableRun = 0

    init(threshold: Int, stableFrames: Int) {
        self.threshold = max(1, threshold)
        self.stableFrames = max(1, stableFrames)
    }

    /// `true` = guardar este frame como `slide_change`.
    mutating func observe(_ h: UInt64) -> Bool {
        if let p = previous, DHash.distance(p, h) <= noise {
            stableRun += 1
        } else {
            stableRun = 1
        }
        previous = h
        guard stableRun >= stableFrames else { return false }
        if let last = lastSaved, DHash.distance(last, h) < threshold { return false }
        lastSaved = h
        return true
    }

    mutating func reset() {
        lastSaved = nil
        previous = nil
        stableRun = 0
    }
}

struct RingFrame: Sendable {
    var atUnixMs: Int64
    var jpeg: Data
    var phash: UInt64
    var width: Int
    var height: Int
}

/// Últimos N segundos de frames (ya en JPEG para no guardar bitmaps).
struct FrameRing {
    let seconds: Int
    private(set) var frames: [RingFrame] = []

    init(seconds: Int) { self.seconds = max(1, seconds) }

    mutating func append(_ f: RingFrame) {
        frames.append(f)
        let cutoff = f.atUnixMs - Int64(seconds) * 1000
        frames.removeAll { $0.atUnixMs < cutoff }
    }

    /// Frame más cercano a `at` dentro de la ventana (o el último si `at` es futuro cercano).
    func nearest(_ at: Int64, toleranceMs: Int64 = 5_000) -> RingFrame? {
        frames.min { abs($0.atUnixMs - at) < abs($1.atUnixMs - at) }
            .flatMap { abs($0.atUnixMs - at) <= Int64(seconds) * 1000 + toleranceMs ? $0 : nil }
    }

    var latest: RingFrame? { frames.last }
}

enum CaptureFiles {
    /// `<dir>/<unix_ms>-<reason>.jpg` (candidatas: `<dir>/<unix_ms>.jpg`).
    static func name(atUnixMs: Int64, reason: CaptureReasonName) -> String {
        reason == .candidate ? "\(atUnixMs).jpg" : "\(atUnixMs)-\(reason.rawValue).jpg"
    }

    static func write(_ frame: RingFrame, reason: CaptureReasonName, dir: String, keyword: String?) throws -> ScreenFrameEvent {
        var url = URL(fileURLWithPath: dir).appendingPathComponent(name(atUnixMs: frame.atUnixMs, reason: reason))
        var n = 1
        while FileManager.default.fileExists(atPath: url.path) {
            url = URL(fileURLWithPath: dir).appendingPathComponent("\(frame.atUnixMs)-\(reason.rawValue)-\(n).jpg")
            n += 1
        }
        try AtomicFile.write(frame.jpeg, to: url)
        return ScreenFrameEvent(
            path: url.path, atUnixMs: frame.atUnixMs, reason: reason, phash: DHash.hex(frame.phash),
            width: UInt32(frame.width), height: UInt32(frame.height), keyword: keyword
        )
    }
}

enum Jpeg {
    static func encode(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }
}

// MARK: - ScreenCaptureKit

final class ImageBox: @unchecked Sendable {
    let image: CGImage
    init(_ i: CGImage) { image = i }
}

final class WindowStreamer: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "acta.screen.frames")
    private let ci = CIContext(options: [.cacheIntermediates: false])
    private let onFrame: @Sendable (ImageBox) -> Void
    private let onStop: @Sendable (Error?) -> Void

    init(onFrame: @escaping @Sendable (ImageBox) -> Void, onStop: @escaping @Sendable (Error?) -> Void) {
        self.onFrame = onFrame
        self.onStop = onStop
    }

    func start(window: SCWindow, maxWidth: Int, fps: Double) async throws {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let cfg = SCStreamConfiguration()
        let scale = Double(filter.pointPixelScale)
        let w = max(1, window.frame.width * scale)
        let h = max(1, window.frame.height * scale)
        let k = min(1, Double(maxWidth) / w)
        cfg.width = Int((w * k).rounded())
        cfg.height = Int((h * k).rounded())
        cfg.minimumFrameInterval = CMTime(seconds: 1 / max(0.1, fps), preferredTimescale: 600)
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.showsCursor = false
        cfg.queueDepth = 3
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
    }

    func stop() async {
        guard let s = stream else { return }
        stream = nil
        try? await s.stopCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sb.isValid,
              let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = atts.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let pb = CMSampleBufferGetImageBuffer(sb)
        else { return }
        let img = CIImage(cvPixelBuffer: pb)
        guard let cg = ci.createCGImage(img, from: img.extent) else { return }
        onFrame(ImageBox(cg))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onStop(error)
    }

    /// Ventana de la app: la que encaja con el título, si no la más grande.
    static func findWindow(pid: Int32, titleHint: String?) async throws -> SCWindow? {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let wins = content.windows.filter { $0.owningApplication?.processID == pid && $0.frame.width > 200 && $0.frame.height > 150 }
        if let hint = titleHint?.lowercased(), !hint.isEmpty,
           let w = wins.first(where: { ($0.title ?? "").lowercased().contains(hint) || hint.contains(($0.title ?? "\u{0}").lowercased()) }) {
            return w
        }
        return wins.max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    }
}

// MARK: - Servicio

public actor ScreenService {
    private let output: Output
    private var args: ScreenStartArgs?
    private var streamer: WindowStreamer?
    private var ring = FrameRing(seconds: 20)
    private var detector = SlideChangeDetector(threshold: 10, stableFrames: 2)
    private var sharing = false
    private var axSharing: Bool?
    private var axEverSaw = false
    private var lastCandidateMs: Int64 = 0
    private var axTask: Task<Void, Never>?
    private var restartTask: Task<Void, Never>?

    public init(output: Output) { self.output = output }

    public func start(_ a: ScreenStartArgs) async throws {
        await stop()
        guard CGPreflightScreenCaptureAccess() else {
            throw ProtocolError(code: .permissionDenied, message: "screen recording permission not granted")
        }
        guard a.format == "jpeg" else { throw ProtocolError(code: .invalidArgs, message: "only jpeg is supported") }
        try FileManager.default.createDirectory(atPath: a.outDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: a.candidatesDir, withIntermediateDirectories: true)
        args = a
        ring = FrameRing(seconds: Int(a.ringSeconds))
        detector = SlideChangeDetector(threshold: Int(a.phashThreshold), stableFrames: Int(a.stableFrames))
        sharing = false
        axSharing = nil
        axEverSaw = false
        try await openStream()
        startAxPolling(pid: a.pid)
    }

    private func openStream() async throws {
        guard let a = args else { return }
        guard let window = try await WindowStreamer.findWindow(pid: a.pid, titleHint: a.windowTitleHint) else {
            throw ProtocolError(code: .notFound, message: "no capturable window for pid \(a.pid)")
        }
        let s = WindowStreamer(
            onFrame: { [weak self] box in
                let at = Clock.unixMs()
                Task { await self?.handle(box, at: at) }
            },
            onStop: { [weak self] err in
                Task { await self?.streamStopped(err) }
            }
        )
        try await s.start(window: window, maxWidth: Int(a.maxWidth), fps: Double(a.fps))
        streamer = s
    }

    private func streamStopped(_ error: Error?) async {
        guard args != nil else { return }
        await output.log("warn", "screen stream stopped: \(error.map { "\($0)" } ?? "?"); retrying")
        streamer = nil
        restartTask?.cancel()
        restartTask = Task { [weak self] in
            for _ in 0..<60 {
                try? await Task.sleep(for: .seconds(5))
                guard let self, await self.isActive, await !self.hasStream else { return }
                if (try? await self.openStream()) != nil { return }
            }
        }
    }

    var isActive: Bool { args != nil }
    var hasStream: Bool { streamer != nil }

    private func startAxPolling(pid: Int32) {
        axTask?.cancel()
        axTask = Task.detached(priority: .utility) { [weak self] in
            while !Task.isCancelled {
                if AXSnapshot.isTrusted() {
                    let r = TeamsAX.readLive(pid: pid)
                    await self?.axUpdate(sharing: r.isMeeting ? (r.sharing ?? false) : nil, presenter: r.presenter)
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    /// AX solo es fiable para "no comparte" si alguna vez vio "comparte" (si
    /// las heurísticas no encajan nunca, manda el detector de frames).
    /// Que comparta Edu (presenter "") queda fuera del MVP: cuenta como no.
    private func axUpdate(sharing raw: Bool?, presenter: String?) async {
        guard args != nil else { return }
        let ax: Bool? = presenter == "" ? false : raw
        if ax == true { axEverSaw = true }
        axSharing = axEverSaw ? (ax ?? false) : nil
        guard let now = axSharing, now != sharing else { return }
        sharing = now
        if !now { detector.reset() }
        await output.emit(.screenShareState(ScreenShareStateEvent(sharing: now, presenter: now ? presenter : nil, source: "ax")))
    }

    private func handle(_ box: ImageBox, at: Int64) async {
        guard let a = args else { return }
        guard let jpeg = Jpeg.encode(box.image, quality: 0.8), let h = DHash.hash(box.image) else { return }
        let frame = RingFrame(atUnixMs: at, jpeg: jpeg, phash: h, width: box.image.width, height: box.image.height)
        ring.append(frame)
        // Con AX diciendo "no comparte" no buscamos diapositivas.
        guard axSharing != false else { return }
        if detector.observe(h) {
            if !sharing, axSharing == nil {
                sharing = true
                await output.emit(.screenShareState(ScreenShareStateEvent(sharing: true, presenter: nil, source: "frame")))
            }
            await save(frame, reason: .slideChange, dir: a.outDir, keyword: nil, emit: true)
        }
        if sharing, at - lastCandidateMs >= Int64(a.candidateEveryS) * 1000 {
            lastCandidateMs = at
            var c = frame
            if let lower = Jpeg.encode(box.image, quality: 0.6) { c.jpeg = lower }
            await save(c, reason: .candidate, dir: a.candidatesDir, keyword: nil, emit: true)
        }
    }

    @discardableResult
    private func save(_ f: RingFrame, reason: CaptureReasonName, dir: String, keyword: String?, emit: Bool) async -> ScreenFrameEvent? {
        do {
            let ev = try CaptureFiles.write(f, reason: reason, dir: dir, keyword: keyword)
            if emit { await output.emit(.screenFrame(ev)) }
            return ev
        } catch {
            await output.log("error", "capture write failed: \(error)")
            return nil
        }
    }

    public func snapshot(_ s: ScreenSnapshotArgs) async throws -> ScreenSnapshotResult {
        guard let a = args else { throw ProtocolError(code: .notFound, message: "screen capture not running") }
        guard let f = ring.nearest(s.atUnixMs) else { return ScreenSnapshotResult(frame: nil) }
        let dir = s.reason == .candidate ? a.candidatesDir : a.outDir
        return ScreenSnapshotResult(frame: await save(f, reason: s.reason, dir: dir, keyword: s.keyword, emit: false))
    }

    public func stop() async {
        args = nil
        axTask?.cancel()
        axTask = nil
        restartTask?.cancel()
        restartTask = nil
        await streamer?.stop()
        streamer = nil
        ring = FrameRing(seconds: 20)
    }
}
