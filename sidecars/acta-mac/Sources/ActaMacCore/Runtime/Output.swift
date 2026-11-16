import ActaMacProtocol
import Foundation

/// Único escritor de stdout. TODO lo que sale por stdout pasa por aquí, en
/// orden y una línea completa cada vez.
///
/// Regla de tiempo real (WP4): los callbacks de audio NUNCA llaman aquí
/// directamente. Escriben en un ring buffer por pista; una tarea lo drena y
/// llama a `emit`. Si el ring se llena se descarta lo más antiguo y se emite
/// `audio.overrun` (nunca se bloquea el hilo de audio).
public actor Output {
    public typealias Sink = @Sendable (Data) throws -> Void

    private let encoder = ProtocolCoding.encoder()
    private let sink: Sink
    private let onBrokenPipe: @Sendable () -> Void

    /// Por defecto escribe en stdout y sale si el pipe se rompe (padre muerto).
    public init(
        sink: Sink? = nil,
        onBrokenPipe: (@Sendable () -> Void)? = nil
    ) {
        self.sink = sink ?? { data in try FileHandle.standardOutput.write(contentsOf: data) }
        self.onBrokenPipe = onBrokenPipe ?? {
            Log.error("stdout write failed; exiting")
            exit(0)
        }
    }

    public func emit(_ event: Event) {
        write(EventLine(ts: Clock.unixMs(), event: event))
    }

    public func respond<R: Encodable & Sendable>(_ line: ResponseLine<R>) {
        write(line)
    }

    public func fail(_ id: UInt64, _ code: ErrorCode, _ message: String) {
        write(ResponseLine<Empty>.failure(id, ProtocolError(code: code, message: message)))
    }

    public func log(_ level: String, _ message: String) {
        emit(.log(LogEvent(level: level, message: message)))
    }

    private func write(_ value: some Encodable) {
        let data: Data
        do {
            data = try encoder.encode(value)
        } catch {
            Log.error("encode failed: \(error)")
            return
        }
        if data.count >= maxLineBytes {
            Log.error("dropping \(data.count)-byte line (over 1 MiB)")
            return
        }
        var line = data
        line.append(0x0A)
        do {
            try sink(line)
        } catch {
            // stdout roto = el padre murió. Salir: nunca quedar huérfano.
            onBrokenPipe()
        }
    }
}

/// Logs a stderr (Rust los vuelca a logs/acta-mac.log).
public enum Log {
    public static func debug(_ message: String) {
        if ProcessInfo.processInfo.environment["ACTA_MAC_DEBUG"] != nil { line("DEBUG", message) }
    }
    public static func info(_ message: String) { line("INFO", message) }
    public static func warn(_ message: String) { line("WARN", message) }
    public static func error(_ message: String) { line("ERROR", message) }

    private static func line(_ level: String, _ message: String) {
        FileHandle.standardError.write(Data("[acta-mac] \(level) \(message)\n".utf8))
    }
}

public enum Clock {
    public static func unixMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }
}
