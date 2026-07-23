// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "HarnessModelRouterApp",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "HarnessModelRouterApp", targets: ["HarnessModelRouterApp"])],
    targets: [
        .executableTarget(name: "HarnessModelRouterApp"),
        .testTarget(name: "HarnessModelRouterAppTests", dependencies: ["HarnessModelRouterApp"]),
    ],
    swiftLanguageModes: [.v5]
)
