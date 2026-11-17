import ActaMacProtocol
import AppKit
import Foundation
import Testing
@testable import ActaMacCore

/// Carpeta temporal con bundles `.app` de mentira.
private struct FakeApplications {
    let root: URL

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("acta-apps-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    @discardableResult
    func app(_ file: String, bundleId: String?, in sub: String? = nil) throws -> URL {
        let dir = sub.map { root.appendingPathComponent($0) } ?? root
        let contents = dir.appendingPathComponent(file).appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        if let bundleId {
            let plist: [String: Any] = ["CFBundleIdentifier": bundleId, "CFBundlePackageType": "APPL"]
            try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
        }
        return contents.deletingLastPathComponent()
    }

    func remove() { try? FileManager.default.removeItem(at: root) }
}

@Test func `scans one level of app bundles and skips the odd ones`() throws {
    let fake = try FakeApplications()
    defer { fake.remove() }
    try fake.app("Beta.app", bundleId: "com.test.beta")
    try fake.app("alfa.app", bundleId: "com.test.alfa")
    try fake.app("Rota.app", bundleId: nil) // sin Info.plist: se salta, no rompe la lista
    try fake.app("Honda.app", bundleId: "com.test.honda", in: "Carpeta") // segundo nivel: no entra
    try Data("x".utf8).write(to: fake.root.appendingPathComponent("notas.txt"))

    let found = InstalledApps.scan(roots: [fake.root, fake.root.appendingPathComponent("no-existe")])
    #expect(found.map(\.bundleId).sorted() == ["com.test.alfa", "com.test.beta"])
    let beta = try #require(found.first { $0.bundleId == "com.test.beta" })
    #expect(beta.name == "Beta")
    #expect(beta.path.hasSuffix("/Beta.app"))
    #expect(!beta.running)
}

@Test func `merges installed and running apps without repeats, sorted by name`() {
    let f = { (id: String, name: String, running: Bool) in InstalledApps.Found(bundleId: id, name: name, path: "/Applications/\(name).app", running: running) }
    let merged = InstalledApps.merge(
        installed: [f("com.z", "zoom.us", false), f("com.a", "Arc", false), f("com.a", "Arc copia", false), f("com.s", "Safari", false)],
        running: [f("COM.S", "Safari", true), f("com.suelta", "beta suelta", true)]
    )
    #expect(merged.map(\.name) == ["Arc", "beta suelta", "Safari", "zoom.us"])
    #expect(merged.map(\.running) == [false, true, true, false])
    #expect(merged.first { $0.name == "Safari" }?.bundleId == "com.s")
}

@Test func `icon files are named after the bundle id and never leave the folder`() {
    #expect(InstalledApps.iconFileName(bundleId: "com.apple.Safari") == "com.apple.Safari.png")
    #expect(InstalledApps.iconFileName(bundleId: "../../etc/passwd") == ".._.._etc_passwd.png")
    #expect(InstalledApps.iconFileName(bundleId: "com.raro app:1") == "com.raro_app_1.png")
}

@Test func `an icon is rendered once and again only when the app changed`() {
    let old = Date(timeIntervalSince1970: 1_000)
    let new = Date(timeIntervalSince1970: 2_000)
    #expect(InstalledApps.needsIcon(appModified: old, iconModified: nil))
    #expect(!InstalledApps.needsIcon(appModified: old, iconModified: new))
    #expect(InstalledApps.needsIcon(appModified: new, iconModified: old))
    #expect(!InstalledApps.needsIcon(appModified: nil, iconModified: old))
}

@Test func `lists the apps with a png icon in the cache folder`() async throws {
    let fake = try FakeApplications()
    defer { fake.remove() }
    try fake.app("Beta.app", bundleId: "com.test.beta")
    let icons = fake.root.appendingPathComponent("cache/app-icons")
    let args = AppsInstalledArgs(iconsDir: icons.path, iconPx: 128)

    let first = await InstalledApps.list(args, roots: [fake.root], running: [])
    #expect(first.apps.map(\.bundleId) == ["com.test.beta"])
    let iconPath = try #require(first.apps[0].iconPath)
    #expect(iconPath == icons.appendingPathComponent("com.test.beta.png").path)
    let rep = try #require(NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: iconPath))))
    #expect(rep.pixelsWide == 128 && rep.pixelsHigh == 128)

    // Segunda llamada: el icono ya está y la app no ha cambiado → no se reescribe.
    let stamp = Date(timeIntervalSince1970: 4_000_000_000)
    try FileManager.default.setAttributes([.modificationDate: stamp], ofItemAtPath: iconPath)
    let second = await InstalledApps.list(args, roots: [fake.root], running: [])
    #expect(second.apps[0].iconPath == iconPath)
    let after = try FileManager.default.attributesOfItem(atPath: iconPath)[.modificationDate] as? Date
    #expect(after == stamp)
}

@Test func `the system profile never fails`() {
    let p = SystemProfile.read()
    #expect(p.fullName?.isEmpty != true)
    #expect(p.preferredLanguages.allSatisfy { !$0.isEmpty })
}
