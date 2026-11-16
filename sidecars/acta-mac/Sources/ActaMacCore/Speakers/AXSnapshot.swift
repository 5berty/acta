// Foto del árbol de Accesibilidad de una app como datos puros (`AXNode`).
// Toda la lógica (¿es ventana de reunión?, roster, hablante activo,
// presentador) trabaja sobre `AXNode` y se testea con fixtures.
//
// Calibración en hardware real: con ACTA_AX_DUMP_DIR=<dir> el sidecar vuelca
// cada 30 s la foto de Teams como JSON (para ajustar las heurísticas).

import ApplicationServices
import AppKit
import Foundation

public struct AXNode: Codable, Equatable, Sendable {
    public var role: String?
    public var subrole: String?
    public var title: String?
    public var desc: String?
    public var value: String?
    public var identifier: String?
    public var children: [AXNode]

    public init(role: String? = nil, subrole: String? = nil, title: String? = nil, desc: String? = nil,
                value: String? = nil, identifier: String? = nil, children: [AXNode] = []) {
        self.role = role
        self.subrole = subrole
        self.title = title
        self.desc = desc
        self.value = value
        self.identifier = identifier
        self.children = children
    }

    /// Textos visibles del nodo (título, descripción, valor), sin vacíos.
    var labels: [String] {
        [title, desc, value].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    /// Recorrido en anchura (incluye el propio nodo).
    func walk(_ visit: (AXNode, Int) -> Void) {
        var queue: [(AXNode, Int)] = [(self, 0)]
        var i = 0
        while i < queue.count {
            let (n, d) = queue[i]
            i += 1
            visit(n, d)
            queue.append(contentsOf: n.children.map { ($0, d + 1) })
        }
    }

    func first(where pred: (AXNode) -> Bool) -> AXNode? {
        var found: AXNode?
        walk { n, _ in if found == nil, pred(n) { found = n } }
        return found
    }
}

/// Lectura real del árbol AX (fuera de los tests).
enum AXSnapshot {
    static func isTrusted() -> Bool { AXIsProcessTrusted() }

    /// Ventanas de la app con hasta `maxNodes` nodos en total.
    static func windows(pid: pid_t, maxNodes: Int = 4000, maxDepth: Int = 60) -> [AXNode] {
        guard AXIsProcessTrusted() else { return [] }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.5)
        // Apps Electron/Chromium solo exponen el árbol web con esto.
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        guard let wins = copy(app, kAXWindowsAttribute) as? [AXUIElement] else { return [] }
        var budget = maxNodes
        return wins.map { snapshot($0, depth: 0, maxDepth: maxDepth, budget: &budget) }
    }

    private static func copy(_ el: AXUIElement, _ attr: String) -> AnyObject? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
        return v
    }

    private static var attrs: CFArray { [
        kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
        kAXValueAttribute, kAXIdentifierAttribute, kAXChildrenAttribute,
    ] as CFArray }

    private static func snapshot(_ el: AXUIElement, depth: Int, maxDepth: Int, budget: inout Int) -> AXNode {
        budget -= 1
        var values: CFArray?
        AXUIElementCopyMultipleAttributeValues(el, attrs, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
        let arr = (values as? [AnyObject]) ?? []
        func str(_ i: Int) -> String? {
            guard i < arr.count else { return nil }
            if let s = arr[i] as? String { return s.isEmpty ? nil : s }
            if let n = arr[i] as? NSNumber, CFGetTypeID(n) != AXValueGetTypeID() { return n.stringValue }
            return nil
        }
        var node = AXNode(role: str(0), subrole: str(1), title: str(2), desc: str(3), value: str(4), identifier: str(5))
        if depth < maxDepth, budget > 0, arr.count > 6, let kids = arr[6] as? [AXUIElement] {
            for k in kids {
                if budget <= 0 { break }
                node.children.append(snapshot(k, depth: depth + 1, maxDepth: maxDepth, budget: &budget))
            }
        }
        return node
    }

    /// Volcado para calibrar (ACTA_AX_DUMP_DIR).
    static func dumpIfRequested(_ nodes: [AXNode], tag: String) {
        guard let dir = ProcessInfo.processInfo.environment["ACTA_AX_DUMP_DIR"], !dir.isEmpty else { return }
        let url = URL(fileURLWithPath: dir).appendingPathComponent("ax-\(tag)-\(Clock.unixMs()).json")
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(nodes) { try? AtomicFile.write(data, to: url) }
    }
}
