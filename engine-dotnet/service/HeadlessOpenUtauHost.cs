using System.Collections.Concurrent;
using OpenUtau.Classic;
using OpenUtau.Core;
using OpenUtau.Core.Format;
using OpenUtau.Core.Render;
using OpenUtau.Core.Ustx;
using OpenUtau.Core.Util;
using OpenUtau.Plugin.Builtin;
using Microsoft.Extensions.Logging;

namespace VoiceBankStudio.Engine;

public sealed record SingingNote(string lyric, int tone, int position, int duration);

public sealed class HeadlessOpenUtauHost : IDisposable
{
    private sealed class EngineSynchronizationContext : SynchronizationContext
    {
        private readonly BlockingCollection<(SendOrPostCallback Callback, object? State)> queue = new();

        public override void Post(SendOrPostCallback d, object? state) => queue.Add((d, state));

        public void Run()
        {
            foreach (var work in queue.GetConsumingEnumerable())
                work.Callback(work.State);
        }

        public void Stop() => queue.CompleteAdding();
    }

    private readonly ILogger<HeadlessOpenUtauHost> logger;
    private readonly EngineSynchronizationContext context = new();
    private readonly TaskCompletionSource<TaskScheduler> ready =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Thread thread;
    private TaskScheduler? scheduler;
    private bool disposed;

    public HeadlessOpenUtauHost(ILogger<HeadlessOpenUtauHost> logger)
    {
        this.logger = logger;
        logger.LogInformation("OpenUtau headless host initialization started.");
        thread = new Thread(InitializeAndRun)
        {
            IsBackground = true,
            Name = "VoiceBankStudio.OpenUtau",
        };
        thread.Start();
        scheduler = ready.Task.GetAwaiter().GetResult();
        logger.LogInformation("OpenUtau headless host initialization completed.");
    }

    private void InitializeAndRun()
    {
        SynchronizationContext.SetSynchronizationContext(context);
        try
        {
            var mainScheduler = TaskScheduler.FromCurrentSynchronizationContext();
            ToolsManager.Inst.Initialize();
            SingerManager.Inst.Initialize();
            DocManager.Inst.Initialize(Thread.CurrentThread, mainScheduler);
            DocManager.Inst.PostOnUIThread = action => context.Post(_ => action(), null);
            Directory.CreateDirectory(PathManager.Inst.CachePath);
            ready.TrySetResult(mainScheduler);
        }
        catch (Exception ex)
        {
            ready.TrySetException(ex);
            return;
        }

        context.Run();
    }

    private Task<T> OnEngineThread<T>(Func<T> action)
    {
        if (disposed || scheduler is null)
            throw new ObjectDisposedException(nameof(HeadlessOpenUtauHost));
        return Task.Factory.StartNew(action, CancellationToken.None,
            TaskCreationOptions.DenyChildAttach, scheduler);
    }

    public async Task<float[]> RenderAsync(
        ClassicSinger singer,
        IReadOnlyList<SingingNote> notes,
        string phonemizer,
        double bpm,
        CancellationToken cancellationToken)
    {
        if (notes.Count is < 1 or > 500)
            throw new ArgumentException("音符は1〜500個にしてください。");
        if (!double.IsFinite(bpm) || bpm is < 40 or > 300)
            throw new ArgumentException("BPMは40〜300の範囲にしてください。");

        logger.LogInformation("OpenUtau render started. Notes={NoteCount}, Phonemizer={Phonemizer}, BPM={Bpm}", notes.Count, phonemizer, bpm);
        try
        {
            var state = await OnEngineThread(() =>
        {
            var project = new UProject();
            Ustx.AddDefaultExpressions(project);
            project.tempos[0].bpm = bpm;

            var track = project.tracks[0];
            track.Singer = singer;
            track.Phonemizer = phonemizer switch
            {
                "ja-cvvc" => new JapaneseCVVCPhonemizer(),
                _ => new JapaneseVCVPhonemizer(),
            };
            track.RendererSettings.renderer = Renderers.WORLDLINE_R;

            var part = new UVoicePart
            {
                trackNo = 0,
                position = 0,
                name = "VoiceBankStudio Render",
            };
            int end = 0;
            foreach (var item in notes.OrderBy(n => n.position))
            {
                if (string.IsNullOrWhiteSpace(item.lyric) || item.lyric.Length > 64)
                    throw new ArgumentException("歌詞は1〜64文字にしてください。");
                if (item.tone is < 24 or > 108 || item.position is < 0 or > 200000 ||
                    item.duration is < 30 or > 7680 || item.position + item.duration > 200000)
                    throw new ArgumentException("音程または音符の長さ・位置が範囲外です。");
                if (item.position < end)
                    throw new ArgumentException("音符が重なっています。最初の歌唱版では単旋律のみ対応します。");

                var note = project.CreateNote(item.tone, item.position, item.duration);
                note.lyric = item.lyric;
                part.notes.Add(note);
                end = item.position + item.duration;
            }
            part.Duration = Math.Max(end, project.resolution);
            project.parts.Add(part);

            DocManager.Inst.ExecuteCmd(new LoadProjectNotification(project));
            project.ValidateFull();
            return (project, part);
        });

            logger.LogInformation("OpenUtau project created and validated. Waiting for phoneme generation.");
            var deadline = DateTime.UtcNow.AddSeconds(30);
            RenderPhrase[] phrases = Array.Empty<RenderPhrase>();
            while (DateTime.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var readyState = await OnEngineThread(() =>
                    (state.part.PhonemesUpToDate, state.part.renderPhrases.ToArray()));
                if (readyState.Item1 && readyState.Item2.Length > 0)
                {
                    phrases = readyState.Item2;
                    logger.LogInformation("OpenUtau phoneme generation completed. PhraseCount={PhraseCount}", phrases.Length);
                    break;
                }
                await Task.Delay(50, cancellationToken);
            }

            if (phrases.Length == 0)
            {
                logger.LogWarning("OpenUtau phoneme generation timed out after 30 seconds.");
                throw new InvalidOperationException("OpenUtauの音素変換またはフレーズ生成が30秒以内に完了しませんでした。");
            }

            var renderer = new WorldlineRenderer(version: 10);
            using var renderCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var renderedPhrases = new List<(int Start, float[] Samples)>();
            int totalSamples = 0;
            int phraseIndex = 0;
            foreach (var phrase in phrases)
            {
                phraseIndex++;
                cancellationToken.ThrowIfCancellationRequested();
                logger.LogInformation("Worldline render started. Phrase={PhraseIndex}/{PhraseCount}, Phones={PhoneCount}", phraseIndex, phrases.Length, phrase.phones.Length);
                var renderStartedAt = DateTime.UtcNow;
                var result = await renderer.Render(
                    phrase,
                    new Progress(Math.Max(1, phrase.phones.Length)),
                    trackNo: 0,
                    cancellation: renderCancellation,
                    isPreRender: false);
                logger.LogInformation("Worldline render completed. Phrase={PhraseIndex}/{PhraseCount}, Samples={SampleCount}, ElapsedMs={ElapsedMs}", phraseIndex, phrases.Length, result.samples?.Length ?? 0, (DateTime.UtcNow-renderStartedAt).TotalMilliseconds);

                if (result.samples is null || result.samples.Length == 0)
                    throw new InvalidOperationException("OpenUtauレンダラーから音声データが返りませんでした。");

                int start = (int)Math.Round((result.positionMs - result.leadingMs) * 44100 / 1000.0);
                int sourceOffset = Math.Max(0, -start);
                int destinationStart = Math.Max(0, start);
                int available = result.samples.Length - sourceOffset;
                if (available <= 0)
                    continue;
                renderedPhrases.Add((destinationStart, result.samples.Skip(sourceOffset).ToArray()));
                totalSamples = Math.Max(totalSamples, destinationStart + available);
            }

            if (totalSamples == 0)
                throw new InvalidOperationException("OpenUtauレンダラーから有効な音声データが返りませんでした。");

            var mixed = new float[totalSamples];
            foreach (var rendered in renderedPhrases)
            {
                for (int i = 0; i < rendered.Samples.Length; i++)
                    mixed[rendered.Start + i] += rendered.Samples[i];
            }
            logger.LogInformation("OpenUtau render completed. TotalSamples={TotalSamples}", mixed.Length);
            return mixed;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "OpenUtau render failed.");
            throw;
        }
        finally
        {
            logger.LogInformation("OpenUtau render cleanup started.");
            try
            {
                await OnEngineThread(() =>
                {
                    DocManager.Inst.ExecuteCmd(new LoadProjectNotification(new UProject()));
                    var cachePath = PathManager.Inst.CachePath;
                    try
                    {
                        if (Directory.Exists(cachePath))
                        {
                            foreach (var file in Directory.EnumerateFiles(cachePath))
                            {
                                try { File.Delete(file); } catch { }
                            }
                            foreach (var directory in Directory.EnumerateDirectories(cachePath))
                            {
                                try { Directory.Delete(directory, recursive: true); } catch { }
                            }
                        }
                    }
                    catch
                    {
                        // Cache cleanup is best-effort; the uploaded voicebank folder is still deleted by the request handler.
                    }
                    return true;
                });
            }
            catch
            {
                // Keep the original render error if the engine is already shutting down.
            }
        }
    }

    public void Dispose()
    {
        if (disposed)
            return;
        disposed = true;
        context.Stop();
        if (Thread.CurrentThread != thread)
            thread.Join(TimeSpan.FromSeconds(3));
    }
}
