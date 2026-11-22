// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VoiceBankStudioAudio",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(name: "VoiceBankStudioAudio", targets: ["VoiceBankStudioAudio"])
    ],
    targets: [
        .target(
            name: "VoiceBankStudioAudio",
            path: "Sources/VoiceBankStudio/Audio"
        ),
        .testTarget(
            name: "VoiceBankStudioAudioTests",
            dependencies: ["VoiceBankStudioAudio"],
            path: "Tests/VoiceBankStudioAudioTests"
        )
    ]
)
