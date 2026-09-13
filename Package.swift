// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PaperRenamer",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "PaperRenamer", targets: ["PaperRenamer"])
    ],
    targets: [
        .executableTarget(
            name: "PaperRenamer",
            path: "Sources/PaperRenamer"
        ),
        .testTarget(
            name: "PaperRenamerTests",
            dependencies: ["PaperRenamer"],
            path: "Tests/PaperRenamerTests"
        )
    ]
)
