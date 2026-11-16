import ActaMacProtocol
import Foundation

/// Trabajos largos cancelables con `job.cancel`. Si se cancela, la respuesta
/// es `cancelled` en el acto aunque la librería (FluidAudio) tarde en
/// enterarse de la cancelación de su tarea.
public actor JobRegistry {
    private var cancels: [String: @Sendable () -> Void] = [:]

    public init() {}

    public func run<T: Sendable>(_ jobId: String, _ work: @escaping @Sendable () async throws -> T) async throws -> T {
        if cancels[jobId] != nil {
            throw ProtocolError(code: .busy, message: "job \(jobId) already running")
        }
        let once = Once<T>()
        let task = Task { try await work() }
        cancels[jobId] = {
            task.cancel()
            once.finish(.failure(ProtocolError(code: .cancelled, message: "job \(jobId) cancelled")))
        }
        defer { cancels[jobId] = nil }
        Task { once.finish(await task.result) }
        return try await once.value()
    }

    /// `true` si había un trabajo con ese id.
    @discardableResult
    public func cancel(_ jobId: String) -> Bool {
        guard let c = cancels[jobId] else { return false }
        c()
        return true
    }

    public func cancelAll() {
        for c in cancels.values { c() }
    }

    public var running: Int { cancels.count }
}

/// Resultado de un solo disparo: el primero que llega gana.
final class Once<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<T, Error>?
    private var waiter: CheckedContinuation<T, Error>?

    func finish(_ r: Result<T, Error>) {
        lock.lock()
        guard result == nil else {
            lock.unlock()
            return
        }
        result = r
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.resume(with: r)
    }

    func value() async throws -> T {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<T, Error>) in
            lock.lock()
            if let r = result {
                lock.unlock()
                c.resume(with: r)
            } else {
                waiter = c
                lock.unlock()
            }
        }
    }
}
