// acta-mac: sidecar nativo. Lee comandos por stdin (una línea JSON cada uno)
// y escribe respuestas/eventos por stdout. Sale al recibir EOF en stdin:
// si el proceso padre muere, el pipe se cierra y el sidecar termina
// (nunca queda huérfano). Además vigila getppid() por si acaso.

import ActaMacCore
import Foundation

// Un pipe roto no debe matar el proceso con SIGPIPE: lo detecta Output y sale limpio.
signal(SIGPIPE, SIG_IGN)

let output = Output()
let dispatcher = Dispatcher(output: output)
let parent = getppid()

// Cinturón y tirantes: si el padre cambia (adoptado por launchd), salir.
Task.detached {
    while true {
        try? await Task.sleep(for: .seconds(2))
        if getppid() != parent {
            Log.warn("parent died; exiting")
            await dispatcher.shutdown()
            exit(0)
        }
    }
}

Log.info("started pid=\(getpid()) parent=\(parent)")
do {
    for try await line in FileHandle.standardInput.bytes.lines {
        if line.utf8.count > 1024 * 1024 {
            Log.error("line too long; dropped")
            continue
        }
        Task { await dispatcher.handle(line: line) }
    }
} catch {
    Log.error("stdin read failed: \(error)")
}
Log.info("stdin closed; exiting")
await dispatcher.shutdown()
exit(0)
