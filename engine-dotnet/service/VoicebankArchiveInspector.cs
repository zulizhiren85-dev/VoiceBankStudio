using System.IO.Compression;
using System.Text;
using OpenUtau.Classic;

namespace VoiceBankStudio.Engine;

public static class VoicebankArchiveInspector
{
    private const long MaxArchiveBytes = 256L * 1024 * 1024;
    private const long MaxExpandedBytes = 1024L * 1024 * 1024;
    private const int MaxEntries = 50000;

    public static async Task<IResult> InspectAsync(IFormFile archive, CancellationToken cancellationToken)
    {
        if (archive is null || archive.Length == 0)
            return Results.BadRequest(new { error = "ZIPファイルが選択されていません。" });
        if (archive.Length > MaxArchiveBytes)
            return Results.BadRequest(new { error = "ZIPファイルは256MB以下にしてください。" });

        var jobRoot = Path.Combine(Path.GetTempPath(), "voicebankstudio", Guid.NewGuid().ToString("N"));
        var extractRoot = Path.Combine(jobRoot, "voicebank");
        Directory.CreateDirectory(extractRoot);

        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            var legacyEncoding = Encoding.GetEncoding(932);
            var seenPaths = new HashSet<string>(StringComparer.Ordinal);
            long expandedBytes = 0;
            var entryCount = 0;

            await using (var input = archive.OpenReadStream())
            using (var zip = new ZipArchive(input, ZipArchiveMode.Read, leaveOpen: false, entryNameEncoding: legacyEncoding))
            {
                foreach (var entry in zip.Entries)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    entryCount++;
                    if (entryCount > MaxEntries)
                        return Results.BadRequest(new { error = "ZIP内のファイル数が上限50000件を超えています。" });

                    var normalized = entry.FullName.Replace('\\', '/');
                    if (string.IsNullOrWhiteSpace(normalized) || normalized.EndsWith('/'))
                        continue;
                    if (normalized.StartsWith('/') || Path.IsPathRooted(normalized) ||
                        normalized.Split('/').Any(part => part is "." or "..") ||
                        normalized.Contains(':'))
                        return Results.BadRequest(new { error = "ZIP内に不正なファイルパスがあります。" });
                    if (!seenPaths.Add(normalized))
                        return Results.BadRequest(new { error = "ZIP内に同じファイル名が重複しています。" });

                    var destination = Path.GetFullPath(Path.Combine(extractRoot, normalized.Replace('/', Path.DirectorySeparatorChar)));
                    var safePrefix = Path.GetFullPath(extractRoot) + Path.DirectorySeparatorChar;
                    if (!destination.StartsWith(safePrefix, StringComparison.Ordinal))
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
                .Take(2)
                .ToArray();
            if (characterFiles.Length == 0)
                return Results.BadRequest(new { error = "ZIP内にcharacter.txtが見つかりません。UTAU音源フォルダをZIPにしてください。" });
            if (characterFiles.Length > 1)
                return Results.BadRequest(new { error = "複数の音源が含まれています。最初は1音源ずつZIPにしてください。" });

            var bank = new Voicebank();
            VoicebankLoader.LoadInfo(bank, characterFiles[0], extractRoot);
            using var singer = new ClassicSinger(bank);
            singer.EnsureLoaded();

            return Results.Ok(new
            {
                loaded = singer.Otos.Count > 0,
                singer.Name,
                singer.Id,
                singer.SingerType,
                otoCount = singer.Otos.Count,
                aliases = singer.Otos.Take(30).Select(oto => new
                {
                    alias = oto.Alias,
                    file = Path.GetRelativePath(singer.Location, oto.File),
                    oto.Offset,
                    oto.Consonant,
                    oto.Cutoff,
                    oto.Preutter,
                    oto.Overlap,
                }),
                errors = singer.Errors,
                extractedBytes = expandedBytes,
                note = "OpenUtau VoicebankLoader / ClassicSingerによる音源読み込み確認です。歌唱レンダリングはまだ行っていません。",
            });
        }
        catch (InvalidDataException ex)
        {
            return Results.BadRequest(new { error = "ZIPを読み取れませんでした。", detail = ex.Message });
        }
        catch (OperationCanceledException)
        {
            return Results.Problem("音源の読み込みがキャンセルされました。", statusCode: 499);
        }
        catch (Exception ex)
        {
            return Results.Problem(title: "音源の読み込みに失敗しました。", detail: ex.GetType().Name + ": " + ex.Message, statusCode: 422);
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
                // Temporary cleanup is best-effort; a later janitor will remove stale job folders.
            }
        }
    }
}
