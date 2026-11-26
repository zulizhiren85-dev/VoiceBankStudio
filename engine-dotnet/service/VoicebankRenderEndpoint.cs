using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using OpenUtau.Classic;

namespace VoiceBankStudio.Engine;

public static class VoicebankRenderEndpoint
{
    private const long MaxArchiveBytes = 800L * 1024 * 1024;
    private const long MaxExpandedBytes = 1024L * 1024 * 1024;
    private const int MaxEntries = 50000;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        MaxDepth = 8,
    };

    public static async Task<IResult> RenderAsync(
        [FromForm] IFormFile? archive,
        [FromForm] string? archiveId,
        [FromForm] string notesJson,
        [FromForm] double bpm,
        [FromForm] string? phonemizer,
        [FromServices] HeadlessOpenUtauHost host,
        [FromServices] ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("VoiceBankStudio.Engine.RenderEndpoint");
        logger.LogInformation("Render request accepted. ArchiveIdPresent={ArchiveIdPresent}, UploadedArchive={UploadedArchive}, NotesJsonLength={NotesJsonLength}", !string.IsNullOrWhiteSpace(archiveId), archive is not null, notesJson?.Length ?? 0);
        string? cachedArchivePath = null;
        if (archive is null && string.IsNullOrWhiteSpace(archiveId))
            return Results.NotFound(new { error = "音源IDがありません。音源をもう一度登録してください。" });
        else if (archive is not null)
        {
            if (archive.Length == 0)
                return Results.BadRequest(new { error = "UTAU音源ZIPを選択してください。" });
            if (archive.Length > MaxArchiveBytes)
                return Results.BadRequest(new { error = "ZIPファイルは800MB以下にしてください。" });
        }
        if (!string.IsNullOrWhiteSpace(phonemizer) && phonemizer != "ja-vcv" && phonemizer != "ja-cvvc")
            return Results.BadRequest(new { error = "対応する発音方式は ja-vcv / ja-cvvc です。" });
        if (!await EngineWorkGate.Gate.WaitAsync(0))
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);

        var jobRoot = Path.Combine(Path.GetTempPath(), "voicebankstudio-render", Guid.NewGuid().ToString("N"));
        string extractRoot = Path.Combine(jobRoot, "voicebank");
        bool extractionCacheHit = false;
        try
        {
            if (archive is null)
            {
                if (VoicebankArchiveCache.TryGetExtractedPath(archiveId, out var cachedExtractRoot))
                {
                    extractRoot = cachedExtractRoot;
                    extractionCacheHit = true;
                    logger.LogInformation("Using cached extracted voicebank. ArchiveIdPresent={ArchiveIdPresent}", true);
                }
                else if (!VoicebankArchiveCache.TryGetPath(archiveId, out cachedArchivePath))
                {
                    return Results.NotFound(new { error = "音源IDが無効または期限切れです。音源をもう一度登録してください。" });
                }
            }

            if (!extractionCacheHit)
            {
                Directory.CreateDirectory(extractRoot);
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                var encoding = Encoding.GetEncoding(932);
                long expandedBytes = 0;
                int entries = 0;
                var seen = new HashSet<string>(StringComparer.Ordinal);

                await using (var input = archive is not null
                    ? archive.OpenReadStream()
                    : new FileStream(cachedArchivePath!, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, useAsync: true))
                using (var zip = new ZipArchive(input, ZipArchiveMode.Read, leaveOpen: false, entryNameEncoding: encoding))
                {
                    foreach (var entry in zip.Entries)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        if (++entries > MaxEntries)
                            return Results.BadRequest(new { error = "ZIP内のファイル数が50000件を超えています。" });
                        var relative = entry.FullName.Replace('\\', '/');
                        if (string.IsNullOrWhiteSpace(relative) || relative.EndsWith('/'))
                            continue;
                        if (relative.StartsWith('/') || Path.IsPathRooted(relative) ||
                            relative.Contains(':') || relative.Split('/').Any(p => p is "." or ".."))
                            return Results.BadRequest(new { error = "ZIP内に不正なファイルパスがあります。" });
                        if (!seen.Add(relative))
                            return Results.BadRequest(new { error = "ZIP内に重複したファイル名があります。" });

                        var destination = Path.GetFullPath(Path.Combine(extractRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
                        var prefix = Path.GetFullPath(extractRoot) + Path.DirectorySeparatorChar;
                        if (!destination.StartsWith(prefix, StringComparison.Ordinal))
                            return Results.BadRequest(new { error = "ZIP内に許可されないファイルパスがあります。" });

                        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                        await using var source = entry.Open();
                        await using var target = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                        var buffer = new byte[64 * 1024];
                        int read;
                        while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
                        {
                            expandedBytes += read;
                            if (expandedBytes > MaxExpandedBytes)
                                return Results.BadRequest(new { error = "ZIPの展開後サイズが1GBを超えています。" });
                            await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                        }
                    }
                }

                logger.LogInformation("Voicebank ZIP extraction completed. Entries={EntryCount}, ExpandedBytes={ExpandedBytes}", entries, expandedBytes);
                if (archive is null && VoicebankArchiveCache.TryStoreExtractedPath(archiveId, extractRoot, out var storedExtractRoot))
                {
                    extractRoot = storedExtractRoot;
                    logger.LogInformation("Extracted voicebank cached for reuse.");
                }
            }
            var characterFiles = Directory.EnumerateFiles(extractRoot, "character.txt", SearchOption.AllDirectories)
                .Take(2).ToArray();
            if (characterFiles.Length != 1)
                return Results.BadRequest(new { error = characterFiles.Length == 0
                    ? "character.txtが見つかりません。UTAU音源フォルダをZIPにしてください。"
                    : "複数の音源が含まれています。1音源ずつZIPにしてください。" });

            var noteList = JsonSerializer.Deserialize<List<SingingNote>>(notesJson, JsonOptions);
            if (noteList is null || noteList.Count is < 1 or > 1000)
                return Results.BadRequest(new { error = "歌詞・音程データは1〜1000音符で指定してください。" });

            logger.LogInformation("Voicebank metadata located. Starting OpenUtau voicebank load.");
            var bank = new Voicebank();
            VoicebankLoader.LoadInfo(bank, characterFiles[0], extractRoot);
            if (bank.SingerType != OpenUtau.Core.Ustx.USingerType.Classic)
                return Results.BadRequest(new { error = "現在のベータ版は通常のUTAU音源（Classic）に対応しています。ENUNU / DiffSinger等は対象外です。" });

            logger.LogInformation("Voicebank metadata loaded. SingerType={SingerType}. Loading singer samples.", bank.SingerType);
            using var singer = new ClassicSinger(bank);
            singer.EnsureLoaded();
            logger.LogInformation("Singer sample loading finished. Loaded={Loaded}, OtoCount={OtoCount}, ErrorCount={ErrorCount}", singer.Loaded, singer.Otos.Count, singer.Errors.Count);
            if (!singer.Loaded || singer.Otos.Count == 0)
                return Results.Problem(title: "UTAU音源を読み込めませんでした。", detail: string.Join("\n", singer.Errors), statusCode: 422);

            var selectedPhonemizer = phonemizer == "ja-cvvc" ? "ja-cvvc" : "ja-vcv";
            logger.LogInformation("Calling headless OpenUtau renderer. Notes={NoteCount}, Phonemizer={Phonemizer}", noteList.Count, selectedPhonemizer);
            var audioFile = await host.RenderToFileAsync(singer, noteList, selectedPhonemizer, bpm, cancellationToken);
            logger.LogInformation("Headless OpenUtau renderer returned. Samples={SampleCount}", audioFile.SampleCount);
            return new StreamingWavFileResult(audioFile.Path, audioFile.SampleCount);
        }
        catch (InvalidDataException ex)
        {
            logger.LogWarning(ex, "Voicebank ZIP data was invalid.");
            return Results.BadRequest(new { error = "ZIPを読み取れませんでした。", detail = ex.Message });
        }
        catch (OperationCanceledException ex)
        {
            logger.LogWarning(ex, "Render request was cancelled.");
            return Results.Problem("歌唱レンダリングがキャンセルされました。", statusCode: 499);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Render endpoint failed.");
            return Results.Problem(title: "歌唱レンダリングに失敗しました。",
                detail: ex.GetType().Name + ": " + ex.Message, statusCode: 422);
        }
        finally
        {
            try
            {
                if (Directory.Exists(jobRoot))
                    Directory.Delete(jobRoot, recursive: true);
            }
            catch
            {
                // Best-effort cleanup; temporary voicebank data is not retained intentionally.
            }
            EngineWorkGate.Gate.Release();
        }
    }

    private sealed class StreamingWavFileResult(string path, long sampleCount) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            try
            {
                var response = httpContext.Response;
                response.StatusCode = StatusCodes.Status200OK;
                response.ContentType = "audio/wav";
                response.Headers["Content-Disposition"] = "attachment; filename=\"VoiceBankStudio-render.wav\"";
                response.ContentLength = checked(44L + sampleCount * sizeof(short));

                byte[] header = new byte[44];
                Encoding.ASCII.GetBytes("RIFF").CopyTo(header, 0);
                BitConverter.GetBytes(checked((int)(36L + sampleCount * sizeof(short)))).CopyTo(header, 4);
                Encoding.ASCII.GetBytes("WAVE").CopyTo(header, 8);
                Encoding.ASCII.GetBytes("fmt ").CopyTo(header, 12);
                Encoding.ASCII.GetBytes("data").CopyTo(header, 36);
                BitConverter.GetBytes(16).CopyTo(header, 16);
                BitConverter.GetBytes((short)1).CopyTo(header, 20);
                BitConverter.GetBytes((short)1).CopyTo(header, 22);
                BitConverter.GetBytes(44100).CopyTo(header, 24);
                BitConverter.GetBytes(44100 * sizeof(short)).CopyTo(header, 28);
                BitConverter.GetBytes((short)sizeof(short)).CopyTo(header, 32);
                BitConverter.GetBytes((short)16).CopyTo(header, 34);
                BitConverter.GetBytes(checked((int)(sampleCount * sizeof(short)))).CopyTo(header, 40);
                await response.Body.WriteAsync(header, httpContext.RequestAborted);

                await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true);
                byte[] floatBuffer = new byte[64 * 1024];
                byte[] pcmBuffer = new byte[32 * 1024];
                long remaining = sampleCount;
                while (remaining > 0)
                {
                    httpContext.RequestAborted.ThrowIfCancellationRequested();
                    int count = (int)Math.Min(remaining, floatBuffer.Length / sizeof(float));
                    int bytes = count * sizeof(float);
                    await input.ReadExactlyAsync(floatBuffer.AsMemory(0, bytes), httpContext.RequestAborted);
                    for (int i = 0; i < count; i++)
                    {
                        float sample = BitConverter.ToSingle(floatBuffer, i * sizeof(float));
                        short value = (short)Math.Round(Math.Clamp(sample, -1f, 1f) * 32767f);
                        pcmBuffer[i * 2] = (byte)value;
                        pcmBuffer[i * 2 + 1] = (byte)(value >> 8);
                    }
                    await response.Body.WriteAsync(pcmBuffer.AsMemory(0, count * sizeof(short)), httpContext.RequestAborted);
                    remaining -= count;
                }
            }
            finally
            {
                try { if (File.Exists(path)) File.Delete(path); } catch { }
            }
        }
    }
}
