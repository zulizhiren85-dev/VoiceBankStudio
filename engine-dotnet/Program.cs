using System.Reflection;
using OpenUtau.Api;

const string expectedOpenUtauCommit = "08222cb7c48c4ab47faa34a6efc34e2c00898a1e";

Console.WriteLine("VoiceBankStudio OpenUtau Core smoke test");
Console.WriteLine($"Expected upstream revision: {expectedOpenUtauCommit}");

var builtinAssembly = Assembly.Load("OpenUtau.Plugin.Builtin");
var phonemizerTypes = builtinAssembly.GetTypes()
    .Where(type => !type.IsAbstract && typeof(Phonemizer).IsAssignableFrom(type))
    .ToDictionary(type => type.Name, StringComparer.Ordinal);

var requiredPhonemizers = new[]
{
    "JapaneseVCVPhonemizer",
    "JapaneseCVVCPhonemizer",
};

foreach (var name in requiredPhonemizers)
{
    if (!phonemizerTypes.TryGetValue(name, out var type))
    {
        throw new InvalidOperationException($"Required OpenUtau phonemizer was not found: {name}");
    }

    if (Activator.CreateInstance(type) is not Phonemizer)
    {
        throw new InvalidOperationException($"Could not instantiate OpenUtau phonemizer: {name}");
    }

    Console.WriteLine($"OK: {name}");
}

Console.WriteLine($"Loaded {phonemizerTypes.Count} built-in phonemizer types.");
Console.WriteLine("Core and Builtin assemblies loaded without starting the desktop UI.");
