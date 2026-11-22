import AVFoundation
import XCTest
@testable import VoiceBankStudioAudio

final class AudioAnalysisServiceTests: XCTestCase {
    func testAnalyzesToneWithoutChangingSourceFile() throws {
        let url = try makeAudio(frequency: 220, amplitude: 0.5, seconds: 1.0)
        defer { try? FileManager.default.removeItem(at: url) }
        let original = try Data(contentsOf: url)

        let result = try AudioAnalysisService.analyze(url: url)

        XCTAssertEqual(result.channelCount, 1)
        XCTAssertEqual(result.sampleRate, 16_000, accuracy: 1)
        XCTAssertEqual(result.durationSeconds, 1.0, accuracy: 0.01)
        XCTAssertGreaterThan(result.peak, 0.45)
        XCTAssertEqual(result.rms, 0.35, accuracy: 0.04)
        let detected = try XCTUnwrap(result.pitchSamples.compactMap(\.frequencyHz).first)
        XCTAssertEqual(detected, 220, accuracy: 12)
        XCTAssertEqual(try Data(contentsOf: url), original)
    }

    func testSilenceDoesNotProducePitch() throws {
        let url = try makeAudio(frequency: nil, amplitude: 0, seconds: 0.75)
        defer { try? FileManager.default.removeItem(at: url) }

        let result = try AudioAnalysisService.analyze(url: url)

        XCTAssertEqual(result.peak, 0, accuracy: 0.0001)
        XCTAssertEqual(result.rms, 0, accuracy: 0.0001)
        XCTAssertTrue(result.pitchSamples.allSatisfy { $0.frequencyHz == nil })
    }

    private func makeAudio(frequency: Double?, amplitude: Double, seconds: Double) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voicebankstudio-test-\(UUID().uuidString).caf")
        let format = try XCTUnwrap(AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        ))
        let frameCount = AVAudioFrameCount(16_000 * seconds)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount))
        buffer.frameLength = frameCount
        let samples = try XCTUnwrap(buffer.floatChannelData?[0])

        for frame in 0..<Int(frameCount) {
            let phase = 2 * Double.pi * (frequency ?? 0) * Double(frame) / 16_000
            samples[frame] = Float(amplitude * sin(phase))
        }

        let file = try AVAudioFile(
            forWriting: url,
            settings: format.settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
        try file.write(from: buffer)
        return url
    }
}
