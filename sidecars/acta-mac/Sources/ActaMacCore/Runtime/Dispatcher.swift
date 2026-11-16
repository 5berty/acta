import ActaMacProtocol
import Foundation

/// Despacha cada comando en su propia tarea: los trabajos largos
/// (`asr.transcribe`, `diarize.run`) no bloquean la lectura de stdin y las
/// respuestas pueden llegar fuera de orden (se correlacionan por `id`).
public actor Dispatcher {
    private let output: Output
    private var shuttingDown = false

    public init(output: Output) {
        self.output = output
    }

    /// Procesa una línea de stdin.
    public func handle(line: String) async {
        let request: Request
        do {
            request = try ProtocolCoding.decoder().decode(Request.self, from: Data(line.utf8))
        } catch RequestDecodingError.unknownCommand(let id, let cmd) {
            await output.fail(id, .unsupported, "unknown command \(cmd)")
            return
        } catch {
            Log.error("bad request line: \(error)")
            return
        }
        await route(request)
    }

    private func route(_ request: Request) async {
        let id = request.id
        switch request.command {
        case .hello:
            let os = ProcessInfo.processInfo.operatingSystemVersion
            await output.respond(.success(id, HelloResult(
                sidecarVersion: "0.1.0",
                protocolVersion: protocolVersion,
                macosVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
                capabilities: []  // TODO(WP4): anunciar lo que esté implementado
            )))
        case .shutdown:
            shuttingDown = true
            // TODO(WP4): parar captura/pantalla/trabajos y cerrar ficheros antes de salir.
            await output.respond(.success(id, Empty()))
            exit(0)
        default:
            // TODO(WP4): enrutar a Audio/, Detection/, Speakers/, Screen/,
            // Transcription/, Permissions/.
            await output.fail(id, .unsupported, "not implemented yet")
        }
    }
}
