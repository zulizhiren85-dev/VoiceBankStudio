using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

namespace VoiceBankStudio.Engine;

public static class VoicebankArchiveCache
{
    private static readonly object Sync = new();
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    private static readonly string Root = Path.Combine(Path.GetTempPath(), "voicebankstudio-bank-cache");
    private static string? currentId;
    private static string? currentPath;
    private static DateTimeOffset expiresAt;

    public static async Task<IResult> RegisterAsync(
        IFormFile? archive,
        CancellationToken cancellationToken)
    {
        if (archive is null || archive.Length == 0)
            return Results.BadRequest(new { error = "UTAU音源ZIPを選択してください。" });
        if (archive.Length > 800L * 1024 * 1024)
            return Results.BadRequest(new { error = "ZIPファイルは800MB以下にしてください。" });

        Directory.CreateDirectory(Root);
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var path = Path.Combine(Root, id + ".zip");
        try
        {
            await using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024, useAsync: true))
                await archive.CopyToAsync(output, cancellationToken);

            string? oldPath;
            lock (Sync)
            {
                oldPath = currentPath;
                currentId = id;
                currentPath = path;
                expiresAt = DateTimeOffset.UtcNow.Add(Lifetime);
            }
            TryDelete(oldPath);
            return Results.Ok(new { archiveId = id, expiresInMinutes = (int)Lifetime.TotalMinutes });
        }
        catch (OperationCanceledException)
        {
            TryDelete(path);
            throw;
        }
        catch (Exception ex)
        {
            TryDelete(path);
            return Results.Problem(title: "音源の一時登録に失敗しました。", detail: ex.Message, statusCode: 500);
        }
    }

    public static bool TryGetPath(string? id, out string path)
    {
        lock (Sync)
        {
            if (!string.IsNullOrWhiteSpace(id) &&
                string.Equals(id, currentId, StringComparison.Ordinal) &&
                currentPath is not null &&
                File.Exists(currentPath) &&
                DateTimeOffset.UtcNow < expiresAt)
            {
                expiresAt = DateTimeOffset.UtcNow.Add(Lifetime);
                path = currentPath;
                return true;
            }
            path = string.Empty;
            return false;
        }
    }

    private static void TryDelete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}
