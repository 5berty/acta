// swift-tools-version: 6.0
// acta-mac — sidecar nativo de acta (WP4). Solo macOS 14.2+ (process taps).
// Habla JSON por líneas por stdin/stdout. Ver docs/01-arquitectura.md §4.
import PackageDescription

let package = Package(
    name: "acta-mac",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "acta-mac", targets: ["acta-mac"]),
    ],
    dependencies: [
        // ASR (Parakeet TDT v3) + diarización (pyannote community-1) en el ANE.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.18.3"),
    ],
    targets: [
        // Tipos Codable del protocolo. Sin dependencias: se testea rápido.
        .target(name: "ActaMacProtocol"),
        // Funcionalidades nativas, una carpeta por feature.
        .target(
            name: "ActaMacCore",
            dependencies: [
                "ActaMacProtocol",
                .product(name: "FluidAudio", package: "FluidAudio"),
            ]
        ),
        .executableTarget(
            name: "acta-mac",
            dependencies: ["ActaMacCore", "ActaMacProtocol"]
        ),
        .testTarget(
            name: "ActaMacProtocolTests",
            dependencies: ["ActaMacProtocol"]
        ),
        // Lógica pura de ActaMacCore (sin hardware ni permisos TCC).
        .testTarget(
            name: "ActaMacCoreTests",
            dependencies: ["ActaMacCore", "ActaMacProtocol", .product(name: "FluidAudio", package: "FluidAudio")]
        ),
    ]
)
