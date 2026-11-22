using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

namespace VoiceBankStudio.Engine;

public static class VoicebankArchiveCache
{
    private static readonly object Sync = new();
    // Render's free instance has ephemeral storage. Keep the test bank available
    // across ordinary page reloads, while bounding retention to one archive.
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);
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
            if (!string.Equals(oldPath, path, StringComparison.Ordinal))
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
        string? expiredPath = null;
        lock (Sync)
        {
            if (!string.IsNullOrWhiteSpace(id) &&
                string.Equals(id, currentId, StringComparison.Ordinal) &&
                currentPath is not null &&
                File.Exists(currentPath) &&
                DateTimeOffset.UtcNow < expiresAt)
            {
                // Sliding expiration: active test sessions keep their bank cached.
                expiresAt = DateTimeOffset.UtcNow.Add(Lifetime);
                path = currentPath;
                return true;
            }

            if (currentPath is not null && DateTimeOffset.UtcNow >= expiresAt)
            {
                expiredPath = currentPath;
                currentId = null;
                currentPath = null;
                expiresAt = DateTimeOffset.MinValue;
            }
            path = string.Empty;
        }
        TryDelete(expiredPath);
        return false;
    }

    private static void TryDelete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}
