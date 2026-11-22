namespace VoiceBankStudio.Engine;

public static class EngineWorkGate
{
    public static SemaphoreSlim Gate { get; } = new(1, 1);
}
