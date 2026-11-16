// Utilidades de escritura de ficheros de salida.

import ActaMacProtocol
import Foundation

/// Escritura atómica: `<path>.tmp` → fsync → rename.
enum AtomicFile {
    static func write(_ data: Data, to url: URL) throws {
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let tmp = url.appendingPathExtension("tmp")
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        let handle = try FileHandle(forWritingTo: tmp)
        do {
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
        } catch {
            try? handle.close()
            try? FileManager.default.removeItem(at: tmp)
            throw error
        }
        if rename(tmp.path, url.path) != 0 {
            let code = errno
            try? FileManager.default.removeItem(at: tmp)
            throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
        }
    }

    static func writeJSON(_ value: some Encodable, to url: URL) throws {
        var data = try ProtocolCoding.encoder().encode(value)
        data.append(0x0A)
        try write(data, to: url)
    }
}
