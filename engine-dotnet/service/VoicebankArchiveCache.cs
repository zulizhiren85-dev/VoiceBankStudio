using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

namespace VoiceBankStudio.Engine;

public static class VoicebankArchiveCache
{
    private static readonly object Sync = new();
    // Render free instances have ephemeral storage. Keep one active bank to stay
    // within the disk budget; the opaque random ID is a bearer token, not an IP key.
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);
    private static readonly string Root = Path.Combine(Path.GetTempPath(), "voicebankstudio-bank-cache");
    private static string? currentId;
    private static string? currentArchivePath;
    private static string? currentExtractedPath;
    private static DateTimeOffset expiresAt;

    public static async Task<IResult> RegisterAsync(
        IFormFile? archive,
        CancellationToken cancellationToken)
    {
        if (archive is null || archive.Length == 0)
            return Results.BadRequest(new { error = "UTAU音源ZIPを選択してください。" });
        if (archive.Length > 800L * 1024 * 1024)
            return Results.BadRequest(new { error = "ZIPファイルは800MB以下にしてください。" });

        await EngineWorkGate.Gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(Root);
            var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            var path = Path.Combine(Root, id + ".zip");
            try
            {
                await using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024, useAsync: true))
                    await archive.CopyToAsync(output, cancellationToken);

                string? oldArchivePath;
                string? oldExtractedPath;
                lock (Sync)
                {
                    oldArchivePath = currentArchivePath;
                    oldExtractedPath = currentExtractedPath;
                    currentId = id;
                    currentArchivePath = path;
                    currentExtractedPath = null;
                    expiresAt = DateTimeOffset.UtcNow.Add(Lifetime);
                }
                TryDelete(oldArchivePath);
                TryDeleteDirectory(oldExtractedPath);
                CleanupOrphanedEntries(path);
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
        finally
        {
            EngineWorkGate.Gate.Release();
        }
    }

    public static bool TryGetPath(string? id, out string path)
    {
        string? expiredArchivePath = null;
        string? expiredExtractedPath = null;
        lock (Sync)
        {
            if (MatchesActiveId(id) && currentArchivePath is not null &&
                File.Exists(currentArchivePath))
            {
                RefreshExpiry();
                path = currentArchivePath;
                return true;
            }

            ExpireIfNeeded(out expiredArchivePath, out expiredExtractedPath);
            path = string.Empty;
        }
        TryDelete(expiredArchivePath);
        TryDeleteDirectory(expiredExtractedPath);
        return false;
    }

    public static bool TryGetExtractedPath(string? id, out string path)
    {
        string? expiredArchivePath = null;
        string? expiredExtractedPath = null;
        lock (Sync)
        {
            if (MatchesActiveId(id) && currentExtractedPath is not null &&
                Directory.Exists(currentExtractedPath))
            {
                RefreshExpiry();
                path = currentExtractedPath;
                return true;
            }

            ExpireIfNeeded(out expiredArchivePath, out expiredExtractedPath);
            path = string.Empty;
        }
        TryDelete(expiredArchivePath);
        TryDeleteDirectory(expiredExtractedPath);
        return false;
    }

    public static bool TryStoreExtractedPath(string? id, string sourcePath, out string path)
    {
        string? archiveToDelete = null;
        lock (Sync)
        {
            if (!MatchesActiveId(id) || currentArchivePath is null ||
                !File.Exists(currentArchivePath) ||
                DateTimeOffset.UtcNow >= expiresAt ||
                !Directory.Exists(sourcePath))
            {
                path = string.Empty;
                return false;
            }

            var destination = Path.Combine(Root, id + ".extracted");
            try
            {
                TryDeleteDirectory(destination);
                Directory.Move(sourcePath, destination);
                currentExtractedPath = destination;

                // The extracted bank is the reusable representation. Keeping both
                // a ~600 MB ZIP and its larger expanded copy wastes ephemeral disk.
                archiveToDelete = currentArchivePath;
                currentArchivePath = null;
                RefreshExpiry();
                path = destination;
            }
            catch
            {
                path = string.Empty;
                return false;
            }
        }
        TryDelete(archiveToDelete);
        return true;
    }

    private static void CleanupOrphanedEntries(string activeArchivePath)
    {
        try
        {
            if (!Directory.Exists(Root))
                return;

            var activePath = Path.GetFullPath(activeArchivePath);
            foreach (var file in Directory.EnumerateFiles(Root))
            {
                if (!string.Equals(Path.GetFullPath(file), activePath, StringComparison.Ordinal))
                    TryDelete(file);
            }

            // Extracted folders from a previous process have no live in-memory ID.
            foreach (var directory in Directory.EnumerateDirectories(Root))
                TryDeleteDirectory(directory);
        }
        catch
        {
            // Cleanup is best-effort; registration itself remains usable.
        }
    }

    private static bool MatchesActiveId(string? id) =>
        !string.IsNullOrWhiteSpace(id) &&
        string.Equals(id, currentId, StringComparison.Ordinal) &&
        DateTimeOffset.UtcNow < expiresAt;

    private static void RefreshExpiry() =>
        expiresAt = DateTimeOffset.UtcNow.Add(Lifetime);

    private static void ExpireIfNeeded(out string? archivePath, out string? extractedPath)
    {
        archivePath = null;
        extractedPath = null;
        if (currentId is null || DateTimeOffset.UtcNow < expiresAt)
            return;

        archivePath = currentArchivePath;
        extractedPath = currentExtractedPath;
        currentId = null;
        currentArchivePath = null;
        currentExtractedPath = null;
        expiresAt = DateTimeOffset.MinValue;
    }

    private static void TryDeleteDirectory(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { if (Directory.Exists(path)) Directory.Delete(path, recursive: true); } catch { }
    }

    private static void TryDelete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}