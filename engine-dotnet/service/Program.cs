using System.Reflection;
using OpenUtau.Api;
using VoiceBankStudio.Engine;
using Microsoft.AspNetCore.Http.Features;

const string serviceName = "VoiceBankStudio.Engine";
const string openUtauRevision = "08222cb7c48c4ab47faa34a6efc34e2c00898a1e";
string[] requiredPhonemizers =
{
    "JapaneseVCVPhonemizer",
    "JapaneseCVVCPhonemizer",
};

var builder = WebApplication.CreateBuilder(args);
var allowedOrigins = (Environment.GetEnvironmentVariable("VOICEBANKSTUDIO_ALLOWED_ORIGINS")
    ?? "https://zulizhiren85-dev.github.io")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options => options.AddPolicy("voicebankstudio", policy =>
    policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddSingleton<HeadlessOpenUtauHost>();
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 270L * 1024 * 1024;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 270L * 1024 * 1024;
});
var app = builder.Build();
app.UseCors("voicebankstudio");

(string[] Found, string[] Missing, string? Error) InspectPhonemizers()
{
    try
    {
        var assembly = Assembly.Load("OpenUtau.Plugin.Builtin");
        var types = assembly.GetTypes()
            .Where(type => !type.IsAbstract && typeof(Phonemizer).IsAssignableFrom(type))
            .ToDictionary(type => type.Name, StringComparer.Ordinal);

        var found = new List<string>();
        var missing = new List<string>();
        foreach (var name in requiredPhonemizers)
        {
            if (!types.TryGetValue(name, out var type))
            {
                missing.Add(name);
                continue;
            }

            if (Activator.CreateInstance(type) is Phonemizer)
                found.Add(name);
            else
                missing.Add(name);
        }

        return (found.ToArray(), missing.ToArray(), null);
    }
    catch (Exception ex)
    {
        return (Array.Empty<string>(), requiredPhonemizers, ex.GetType().Name + ": " + ex.Message);
    }
}

app.MapGet("/", () => Results.Ok(new
{
    service = serviceName,
    status = "ready",
    health = "/health",
    engineStatus = "/api/v1/engine/status",
}));

app.MapPost("/api/v1/voicebanks/inspect", VoicebankArchiveInspector.InspectAsync)
    .DisableAntiforgery();
app.MapPost("/api/v1/render", VoicebankRenderEndpoint.RenderAsync)
    .DisableAntiforgery();

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = serviceName,
    runtime = Environment.Version.ToString(),
}));

app.MapGet("/api/v1/engine/status", () =>
{
    var inspection = InspectPhonemizers();
    return Results.Ok(new
    {
        service = serviceName,
        openUtauRevision,
        coreAssemblyLoaded = inspection.Error is null,
        phonemizers = new
        {
            required = requiredPhonemizers,
            available = inspection.Found,
            missing = inspection.Missing,
        },
        voicebankInspectionAvailable = true,
        renderingApiAvailable = true,
        renderingReady = false,
        phonemizersReady = inspection.Missing.Length == 0 && inspection.Error is null,
        note = "This endpoint verifies Core/Builtin assembly loading only. It does not load a voicebank or render audio.",
        error = inspection.Error,
    });
});

app.Run();
