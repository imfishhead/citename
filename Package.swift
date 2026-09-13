// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CiteName",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "citename", targets: ["CiteName"])
    ],
    targets: [
        .executableTarget(
            name: "CiteName",
            path: "Sources/CiteName"
        ),
        .testTarget(
            name: "CiteNameTests",
            dependencies: ["CiteName"],
            path: "Tests/CiteNameTests"
        )
    ]
)
