namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class MachineDriftSummary
{
    public Guid MachineId { get; set; }
    public DriftMatchStatus MatchStatus { get; set; }
    public DriftRiskSeverity RiskSeverity { get; set; }
    public DateTimeOffset CalculatedAt { get; set; }
}

public enum DriftMatchStatus { Unknown, Matched, Mismatch }
public enum DriftRiskSeverity { None, High, Critical }
