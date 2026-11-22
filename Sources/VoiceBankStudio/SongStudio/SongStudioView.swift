import SwiftUI
import AVFoundation
import UniformTypeIdentifiers

struct SongStudioView: View {
    @State private var isImporterPresented = false
    @State private var importedAudioURL: URL?
    @State private var importedAudioName = "まだ曲が読み込まれていません"
    @State private var player: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var isAnalyzing = false
    @State private var analysisResult: AudioAnalysisResult?
    @State private var statusMessage = "音声ファイルを読み込んで始めましょう。"
    @State private var durationText = "--:--"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Image(systemName: "waveform")
                            .font(.system(size: 48, weight: .medium))
                            .foregroundStyle(.tint)
                        Text("Song Studio")
                            .font(.largeTitle.bold())
                        Text("iPad内で音声を読み込み・解析")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 20)

                    VStack(alignment: .leading, spacing: 12) {
                        Label("読み込んだ音声", systemImage: "music.note")
                            .font(.headline)
                        Text(importedAudioName)
                            .font(.body)
                            .lineLimit(2)
                            .textSelection(.enabled)
                        HStack {
                            Text("長さ")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(durationText)
                                .monospacedDigit()
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))

                    Button {
                        isImporterPresented = true
                    } label: {
                        Label("音声ファイルを読み込む", systemImage: "folder.badge.plus")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    HStack(spacing: 12) {
                        Button {
                            togglePlayback()
                        } label: {
                            Label(isPlaying ? "一時停止" : "再生", systemImage: isPlaying ? "pause.fill" : "play.fill")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(importedAudioURL == nil)

                        Button {
                            stopPlayback()
                        } label: {
                            Label("停止", systemImage: "stop.fill")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(importedAudioURL == nil)
                    }

                    Button {
                        analyzeImportedAudio()
                    } label: {
                        if isAnalyzing {
                            ProgressView("端末内で解析中…")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        } else {
                            Label("端末内で音声を解析（通信なし）", systemImage: "waveform.path")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(importedAudioURL == nil || isAnalyzing)

                    if let result = analysisResult {
                        analysisCard(result)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Label("状態", systemImage: "info.circle")
                            .font(.headline)
                        Text(statusMessage)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
                .padding()
            }
            .navigationTitle("VoiceBankStudio")
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(
                isPresented: $isImporterPresented,
                allowedContentTypes: [.audio],
                allowsMultipleSelection: false,
                onCompletion: handleImport
            )
        }
    }

    private func analysisCard(_ result: AudioAnalysisResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("端末内解析結果", systemImage: "chart.xyaxis.line")
                .font(.headline)
            metricRow("サンプルレート", String(format: "%.0f Hz", result.sampleRate))
            metricRow("チャンネル", "\(result.channelCount) ch")
            metricRow("Peak", String(format: "%.4f", result.peak))
            metricRow("RMS", String(format: "%.4f", result.rms))
            metricRow("解析した音声", String(format: "%.2f 秒", Double(result.analyzedFrames) / result.sampleRate))
            Divider()
            Text("音程の目安（約0.5秒ごと）")
                .font(.subheadline.weight(.semibold))
            if result.pitchSamples.isEmpty {
                Text("音程を推定できる区間がありませんでした。")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(result.pitchSamples) { sample in
                    HStack {
                        Text(String(format: "%.1f秒", sample.timeSeconds))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(width: 64, alignment: .leading)
                        Text(sample.noteName ?? "検出なし")
                            .fontWeight(.medium)
                        Spacer()
                        Text(sample.frequencyHz.map { String(format: "%.1f Hz", $0) } ?? "—")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                        Text(String(format: "%.0f%%", sample.confidence * 100))
                            .monospacedDigit()
                            .foregroundStyle(.tertiary)
                            .frame(width: 44, alignment: .trailing)
                    }
                    .font(.caption)
                }
                .frame(maxHeight: 260)
            }
            Text("音程は単音向けの簡易推定です。和音・伴奏・息声では誤判定する場合があります。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
    }

    private func metricRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(.subheadline)
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let sourceURL = urls.first else { return }
            let hasAccess = sourceURL.startAccessingSecurityScopedResource()
            defer {
                if hasAccess { sourceURL.stopAccessingSecurityScopedResource() }
            }

            do {
                let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let audioFolderURL = documentsURL.appendingPathComponent("ImportedAudio", isDirectory: true)
                try FileManager.default.createDirectory(at: audioFolderURL, withIntermediateDirectories: true)

                let destinationURL = uniqueDestination(in: audioFolderURL, fileName: sourceURL.lastPathComponent)
                try FileManager.default.copyItem(at: sourceURL, to: destinationURL)

                let newPlayer = try AVAudioPlayer(contentsOf: destinationURL)
                newPlayer.prepareToPlay()
                player = newPlayer
                importedAudioURL = destinationURL
                importedAudioName = destinationURL.lastPathComponent
                durationText = formatDuration(newPlayer.duration)
                isPlaying = false
                analysisResult = nil
                statusMessage = "音声をiPad内にコピーしました。元ファイルは変更していません。通信は行っていません。"
            } catch {
                statusMessage = "読み込みに失敗しました：\(error.localizedDescription)"
            }

        case .failure(let error):
            statusMessage = "ファイルを読み込めませんでした：\(error.localizedDescription)"
        }
    }

    private func analyzeImportedAudio() {
        guard let url = importedAudioURL else { return }
        isAnalyzing = true
        analysisResult = nil
        statusMessage = "音声を短い区間に分けて端末内で解析しています。"

        Task {
            do {
                let result = try await Task.detached(priority: .userInitiated) {
                    try AudioAnalysisService.analyze(url: url)
                }.value
                analysisResult = result
                statusMessage = "解析が完了しました。元の音声ファイルは変更していません。"
            } catch {
                statusMessage = "解析に失敗しました：\(error.localizedDescription)"
            }
            isAnalyzing = false
        }
    }

    private func uniqueDestination(in folder: URL, fileName: String) -> URL {
        let original = folder.appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: original.path) else { return original }
        let name = original.deletingPathExtension().lastPathComponent
        let ext = original.pathExtension
        var index = 2
        while true {
            let candidateName = ext.isEmpty ? "\(name) \(index)" : "\(name) \(index).\(ext)"
            let candidate = folder.appendingPathComponent(candidateName)
            if !FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            index += 1
        }
    }

    private func togglePlayback() {
        guard let player else { return }
        if player.isPlaying {
            player.pause()
            isPlaying = false
        } else {
            if player.currentTime >= player.duration { player.currentTime = 0 }
            isPlaying = player.play()
        }
    }

    private func stopPlayback() {
        player?.stop()
        player?.currentTime = 0
        isPlaying = false
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        guard duration.isFinite, duration >= 0 else { return "--:--" }
        let totalSeconds = Int(duration)
        return String(format: "%d:%02d", totalSeconds / 60, totalSeconds % 60)
    }
}
