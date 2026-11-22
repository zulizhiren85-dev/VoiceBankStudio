import AVFoundation
import Foundation

struct PitchSample: Sendable, Identifiable {
    let id: Int
    let timeSeconds: Double
    let frequencyHz: Double?
    let noteName: String?
    let confidence: Double
}

struct AudioAnalysisResult: Sendable {
    let fileName: String
    let durationSeconds: Double
    let sampleRate: Double
    let channelCount: Int
    let peak: Double
    let rms: Double
    let pitchSamples: [PitchSample]
    let analyzedFrames: Int64
}

enum AudioAnalysisError: LocalizedError {
    case unsupportedFormat
    case emptyAudio
    case bufferAllocationFailed

    var errorDescription: String? {
        switch self {
        case .unsupportedFormat:
            return "この音声形式は端末内解析に対応していません。"
        case .emptyAudio:
            return "音声データが空か、読み込めませんでした。"
        case .bufferAllocationFailed:
            return "解析用メモリを確保できませんでした。ほかのアプリを閉じて再試行してください。"
        }
    }
}

/// Reads audio in short buffers. The imported source file is never modified
/// and the full recording is never loaded into memory at once.
enum AudioAnalysisService {
    static func analyze(url: URL, chunkSeconds: Double = 0.5) throws -> AudioAnalysisResult {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let channels = Int(format.channelCount)
        let sampleRate = format.sampleRate
        let totalFrames = file.length

        guard channels > 0, sampleRate > 0, totalFrames > 0,
              format.commonFormat == .pcmFormatFloat32,
              let chunkCapacity = AVAudioFrameCount(exactly: max(1024, Int(sampleRate * chunkSeconds))) else {
            throw AudioAnalysisError.unsupportedFormat
        }

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunkCapacity) else {
            throw AudioAnalysisError.bufferAllocationFailed
        }
        var peak = 0.0
        var sumSquares = 0.0
        var sampleCount: Int64 = 0
        var timeline: [PitchSample] = []
        var chunkIndex = 0

        while file.framePosition < totalFrames {
            try file.read(into: buffer, frameCount: chunkCapacity)
            let frames = Int(buffer.frameLength)
            guard frames > 0, let channelData = buffer.floatChannelData else { break }

            var mono = [Double](repeating: 0, count: frames)
            for frame in 0..<frames {
                var mixed = 0.0
                for channel in 0..<channels {
                    mixed += Double(channelData[channel][frame])
                }
                mixed /= Double(channels)
                mono[frame] = mixed
                peak = max(peak, abs(mixed))
                sumSquares += mixed * mixed
                sampleCount += 1
            }

            if frames >= Int(sampleRate * 0.08) {
                let estimate = estimatePitch(mono, sampleRate: sampleRate)
                timeline.append(PitchSample(
                    id: chunkIndex,
                    timeSeconds: Double(chunkIndex) * Double(chunkCapacity) / sampleRate,
                    frequencyHz: estimate.frequency,
                    noteName: estimate.frequency.map(noteName),
                    confidence: estimate.confidence
                ))
            }
            chunkIndex += 1
        }

        guard sampleCount > 0 else { throw AudioAnalysisError.emptyAudio }
        let rms = sqrt(sumSquares / Double(sampleCount))
        return AudioAnalysisResult(
            fileName: url.lastPathComponent,
            durationSeconds: Double(totalFrames) / sampleRate,
            sampleRate: sampleRate,
            channelCount: channels,
            peak: peak,
            rms: rms,
            pitchSamples: timeline,
            analyzedFrames: sampleCount
        )
    }

    private static func estimatePitch(_ source: [Double], sampleRate: Double) -> (frequency: Double?, confidence: Double) {
        let stride = max(1, source.count / 4096)
        let samples = Swift.stride(from: 0, to: source.count, by: stride).map { source[$0] }
        guard samples.count >= 128 else { return (nil, 0) }

        let mean = samples.reduce(0, +) / Double(samples.count)
        let centered = samples.map { $0 - mean }
        let energy = centered.reduce(0) { $0 + $1 * $1 }
        guard energy > 1e-8 else { return (nil, 0) }

        let effectiveRate = sampleRate / Double(stride)
        let minLag = max(1, Int(effectiveRate / 1000.0))
        let maxLag = min(samples.count / 2, Int(effectiveRate / 60.0))
        guard maxLag > minLag else { return (nil, 0) }

        var bestLag = 0
        var bestScore = 0.0
        for lag in minLag...maxLag {
            var cross = 0.0
            var leftEnergy = 0.0
            var rightEnergy = 0.0
            for index in 0..<(centered.count - lag) {
                let a = centered[index]
                let b = centered[index + lag]
                cross += a * b
                leftEnergy += a * a
                rightEnergy += b * b
            }
            let denominator = sqrt(leftEnergy * rightEnergy)
            let score = denominator > 1e-12 ? cross / denominator : 0
            if score > bestScore {
                bestScore = score
                bestLag = lag
            }
            if score >= 0.985 {
                bestScore = score
                bestLag = lag
                break
            }
        }

        guard bestLag > 0, bestScore >= 0.55 else { return (nil, bestScore) }
        return (effectiveRate / Double(bestLag), min(1, max(0, bestScore)))
    }

    private static func noteName(_ frequency: Double) -> String {
        let midi = Int((69 + 12 * log2(frequency / 440)).rounded())
        let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        return "\(names[(midi % 12 + 12) % 12])\(midi / 12 - 1)"
    }
}
