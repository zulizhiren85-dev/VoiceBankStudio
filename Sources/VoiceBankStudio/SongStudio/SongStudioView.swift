import SwiftUI
import AVFoundation
import UniformTypeIdentifiers

struct SongStudioView: View {
    @State private var isImporterPresented = false
    @State private var importedAudioURL: URL?
    @State private var importedAudioName = "まだ曲が読み込まれていません"
    @State private var player: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var statusMessage = "音声ファイルを読み込んで始めましょう。"
    @State private var durationText = "--:--"

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .font(.system(size: 48, weight: .medium))
                        .foregroundStyle(.tint)
                    Text("Song Studio")
                        .font(.largeTitle.bold())
                    Text("曲の作成・解析")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 28)

                VStack(alignment: .leading, spacing: 12) {
                    Label("読み込んだ音声", systemImage: "music.note")
                        .font(.headline)
                    Text(importedAudioName)
                        .font(.body)
                        .lineLimit(2)
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

                HStack(spacing: 16) {
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

                VStack(alignment: .leading, spacing: 8) {
                    Label("状態", systemImage: "info.circle")
                        .font(.headline)
                    Text(statusMessage)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()

                Spacer(minLength: 0)
            }
            .padding()
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

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let sourceURL = urls.first else { return }
            let hasAccess = sourceURL.startAccessingSecurityScopedResource()
            defer {
                if hasAccess {
                    sourceURL.stopAccessingSecurityScopedResource()
                }
            }

            do {
                let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let audioFolderURL = documentsURL.appendingPathComponent("ImportedAudio", isDirectory: true)
                try FileManager.default.createDirectory(at: audioFolderURL, withIntermediateDirectories: true)

                let safeName = sourceURL.lastPathComponent
                let destinationURL = uniqueDestination(in: audioFolderURL, fileName: safeName)
                try FileManager.default.copyItem(at: sourceURL, to: destinationURL)

                let newPlayer = try AVAudioPlayer(contentsOf: destinationURL)
                newPlayer.prepareToPlay()
                player = newPlayer
                importedAudioURL = destinationURL
                importedAudioName = safeName
                durationText = formatDuration(newPlayer.duration)
                isPlaying = false
                statusMessage = "音声をアプリ内にコピーして保存しました。元ファイルは変更していません。"
            } catch {
                statusMessage = "読み込みに失敗しました：\(error.localizedDescription)"
            }

        case .failure(let error):
            statusMessage = "ファイルを読み込めませんでした：\(error.localizedDescription)"
        }
    }

    private func uniqueDestination(in folder: URL, fileName: String) -> URL {
        let original = folder.appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: original.path) else {
            return original
        }

        let name = original.deletingPathExtension().lastPathComponent
        let ext = original.pathExtension
        var index = 2
        while true {
            let candidateName = ext.isEmpty ? "\(name) \(index)" : "\(name) \(index).\(ext)"
            let candidate = folder.appendingPathComponent(candidateName)
            if !FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            index += 1
        }
    }

    private func togglePlayback() {
        guard let player else { return }
        if player.isPlaying {
            player.pause()
            isPlaying = false
        } else {
            if player.currentTime >= player.duration {
                player.currentTime = 0
            }
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
