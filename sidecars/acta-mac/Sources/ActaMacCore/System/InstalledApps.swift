// system.profile — nombre de la cuenta e idiomas preferidos de macOS, para
// proponerlos en la bienvenida (acta nunca los aplica sola).
// apps.installed — apps instaladas y en marcha con su icono en PNG, para
// elegir una app sin conocer su identificador.

import ActaMacProtocol
import AppKit
import Foundation

public enum SystemProfile {
    public static func read() -> SystemProfileResult {
        let name = NSFullUserName().trimmingCharacters(in: .whitespacesAndNewlines)
        let languages = Locale.preferredLanguages.filter { !$0.isEmpty }
        return SystemProfileResult(fullName: name.isEmpty ? nil : name, preferredLanguages: languages)
    }
}

public enum InstalledApps {
    struct Found: Equatable, Sendable {
        var bundleId: String
        var name: String
        var path: String
        var running: Bool
    }

    /// Dónde instala apps macOS (solo el primer nivel de cada carpeta).
    static func defaultRoots(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [URL] {
        ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities"]
            .map { URL(fileURLWithPath: $0, isDirectory: true) } + [home.appendingPathComponent("Applications", isDirectory: true)]
    }

    /// Bundles `.app` de primer nivel. Una carpeta que no existe o una app
    /// sin identificador se saltan: nunca tumban la lista.
    static func scan(roots: [URL]) -> [Found] {
        var out: [Found] = []
        for root in roots {
            let entries = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
            for url in entries where url.pathExtension.lowercased() == "app" {
                guard let bundleId = Bundle(url: url)?.bundleIdentifier, !bundleId.isEmpty else { continue }
                out.append(Found(bundleId: bundleId, name: displayName(of: url), path: url.path, running: false))
            }
        }
        return out
    }

    /// Nombre como lo enseña el Finder (traducido), sin la extensión.
    static func displayName(of url: URL) -> String {
        var name = FileManager.default.displayName(atPath: url.path)
        if name.lowercased().hasSuffix(".app") { name.removeLast(4) }
        return name.isEmpty ? url.deletingPathExtension().lastPathComponent : name
    }

    /// Apps normales en marcha (las que salen en el Dock).
    static func runningApps() -> [Found] {
        NSWorkspace.shared.runningApplications.compactMap { app in
            guard app.activationPolicy == .regular, !app.isTerminated,
                  let bundleId = app.bundleIdentifier, !bundleId.isEmpty, let url = app.bundleURL
            else { return nil }
            return Found(bundleId: bundleId, name: app.localizedName ?? displayName(of: url), path: url.path, running: true)
        }
    }

    /// Sin repetir (por identificador, sin distinguir mayúsculas; gana la
    /// primera instalada) y por nombre sin distinguir mayúsculas.
    static func merge(installed: [Found], running: [Found]) -> [Found] {
        var out: [Found] = []
        var index: [String: Int] = [:]
        for app in installed where index[app.bundleId.lowercased()] == nil {
            index[app.bundleId.lowercased()] = out.count
            out.append(app)
        }
        for app in running {
            if let i = index[app.bundleId.lowercased()] {
                out[i].running = true
            } else {
                index[app.bundleId.lowercased()] = out.count
                out.append(app)
            }
        }
        return out.sorted {
            let order = $0.name.localizedCaseInsensitiveCompare($1.name)
            return order == .orderedSame ? $0.bundleId < $1.bundleId : order == .orderedAscending
        }
    }

    /// `<bundle id>.png`, sin caracteres que puedan salir de la carpeta.
    static func iconFileName(bundleId: String) -> String {
        let safe = bundleId.map { c -> Character in
            c.isASCII && (c.isLetter || c.isNumber || c == "." || c == "-" || c == "_") ? c : "_"
        }
        return String(safe) + ".png"
    }

    /// Falta el icono, o la app es más nueva que él (se actualizó).
    static func needsIcon(appModified: Date?, iconModified: Date?) -> Bool {
        guard let iconModified else { return true }
        guard let appModified else { return false }
        return appModified > iconModified
    }

    private static func modified(_ path: String) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
    }

    /// Icono de la app como PNG cuadrado de `px` píxeles.
    static func pngData(appPath: String, px: Int) -> Data? {
        let image = NSWorkspace.shared.icon(forFile: appPath)
        guard px > 0,
              let rep = NSBitmapImageRep(
                  bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                  hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
              ),
              let context = NSGraphicsContext(bitmapImageRep: rep)
        else { return nil }
        rep.size = NSSize(width: px, height: px)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: px, height: px), from: .zero, operation: .copy, fraction: 1)
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    /// Ruta del PNG en la caché (lo escribe si hace falta). `nil` si no se pudo.
    static func cachedIcon(for app: Found, in dir: URL, px: Int) -> String? {
        let file = dir.appendingPathComponent(iconFileName(bundleId: app.bundleId))
        if !needsIcon(appModified: modified(app.path), iconModified: modified(file.path)) {
            return file.path
        }
        guard let png = pngData(appPath: app.path, px: px) else { return nil }
        do {
            try AtomicFile.write(png, to: file)
            return file.path
        } catch {
            Log.warn("no se pudo guardar el icono de \(app.bundleId): \(error)")
            return nil
        }
    }

    public static func list(_ a: AppsInstalledArgs) async -> AppsInstalledResult {
        await list(a, roots: defaultRoots(), running: runningApps())
    }

    /// AppKit dibuja en el hilo principal: los iconos se sacan ahí, de uno en
    /// uno, para no retener el hilo mientras se recorren cientos de apps.
    static func list(_ a: AppsInstalledArgs, roots: [URL], running: [Found]) async -> AppsInstalledResult {
        let dir = URL(fileURLWithPath: a.iconsDir, isDirectory: true)
        let px = Int(min(max(a.iconPx, 16), 1024))
        var wires: [InstalledAppWire] = []
        for app in merge(installed: scan(roots: roots), running: running) {
            let icon = await MainActor.run { cachedIcon(for: app, in: dir, px: px) }
            wires.append(InstalledAppWire(bundleId: app.bundleId, name: app.name, path: app.path, running: app.running, iconPath: icon))
        }
        return AppsInstalledResult(apps: wires)
    }
}
