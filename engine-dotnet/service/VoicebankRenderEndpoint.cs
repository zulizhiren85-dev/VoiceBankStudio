using System.IO.Compression;
using System.Text;
using System.Text.Json;
using OpenUtau.Classic;

namespace VoiceBankStudio.Engine;

public static class VoicebankRenderEndpoint
{
    private const long MaxArchiveBytes = 256L * 1024 * 1024;
    private const long MaxExpandedBytes = 1024L * 1024 * 1024;
    private const int MaxEntries = 50000;
    private static readonly SemaphoreSlim RenderGate = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        MaxDepth = 8,
    };

    public static async Task<IResult> RenderAsync(
        IFormFile archive,
        string notesJson,
        double bpm,
        string? phonemizer,
        HeadlessOpenUtauHost host,
        CancellationToken cancellationToken)
    {
        if (archive is null || archive.Length == 0)
            return Results.BadRequest(new { error = "UTAU音源ZIPを選択してください。" });
        if (archive.Length > MaxArchiveBytes)
            return Results.BadRequest(new { error = "ZIPファイルは256MB以下にしてください。" });
        if (!await RenderGate.WaitAsync(0))
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);

        var jobRoot = Path.Combine(Path.GetTempPath(), "voicebankstudio-render", Guid.NewGuid().ToString("N"));
        var extractRoot = Path.Combine(jobRoot, "voicebank");
        try
        {
            Directory.CreateDirectory(extractRoot);
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            var encoding = Encoding.GetEncoding(932);
            long expandedBytes = 0;
            int entries = 0;
            var seen = new HashSet<string>(StringComparer.Ordinal);

            await using (var input = archive.OpenReadStream())
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

            var characterFiles = Directory.EnumerateFiles(extractRoot, "character.txt", SearchOption.AllDirectories)
                .Take(2).ToArray();
            if (characterFiles.Length != 1)
                return Results.BadRequest(new { error = characterFiles.Length == 0
                    ? "character.txtが見つかりません。UTAU音源フォルダをZIPにしてください。"
                    : "複数の音源が含まれています。1音源ずつZIPにしてください。" });

            var noteList = JsonSerializer.Deserialize<List<SingingNote>>(notesJson, JsonOptions);
            if (noteList is null || noteList.Count is < 1 or > 500)
                return Results.BadRequest(new { error = "歌詞・音程データは1〜500音符で指定してください。" });

            var bank = new Voicebank();
            VoicebankLoader.LoadInfo(bank, characterFiles[0], extractRoot);
            if (bank.SingerType != OpenUtau.Core.Ustx.USingerType.Classic)
                return Results.BadRequest(new { error = "現在のベータ版は通常のUTAU音源（Classic）に対応しています。ENUNU / DiffSinger等は対象外です。" });

            using var singer = new ClassicSinger(bank);
            singer.EnsureLoaded();
            if (!singer.Loaded || singer.Otos.Count == 0)
                return Results.Problem(title: "UTAU音源を読み込めませんでした。", detail: string.Join("\n", singer.Errors), statusCode: 422);

            var selectedPhonemizer = phonemizer == "ja-cvvc" ? "ja-cvvc" : "ja-vcv";
            var samples = await host.RenderAsync(singer, noteList, selectedPhonemizer, bpm, cancellationToken);
            var wav = ToMono16Wav(samples, 44100);
            return Results.File(wav, "audio/wav", "VoiceBankStudio-render.wav");
        }
        catch (InvalidDataException ex)
        {
            return Results.BadRequest(new { error = "ZIPを読み取れませんでした。", detail = ex.Message });
        }
        catch (OperationCanceledException)
        {
            return Results.Problem("歌唱レンダリングがキャンセルされました。", statusCode: 499);
        }
        catch (Exception ex)
        {
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
            RenderGate.Release();
        }
    }

    private static byte[] ToMono16Wav(float[] samples, int sampleRate)
    {
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        int dataBytes = checked(samples.Length * sizeof(short));
        writer.Write(Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(36 + dataBytes);
        writer.Write(Encoding.ASCII.GetBytes("WAVE"));
        writer.Write(Encoding.ASCII.GetBytes("fmt "));
        writer.Write(16);
        writer.Write((short)1);
        writer.Write((short)1);
        writer.Write(sampleRate);
        writer.Write(sampleRate * sizeof(short));
        writer.Write((short)sizeof(short));
        writer.Write((short)16);
        writer.Write(Encoding.ASCII.GetBytes("data"));
        writer.Write(dataBytes);
        foreach (var sample in samples)
        {
            var value = (short)Math.Round(Math.Clamp(sample, -1f, 1f) * 32767f);
            writer.Write(value);
        }
        writer.Flush();
        return stream.ToArray();
    }
}
