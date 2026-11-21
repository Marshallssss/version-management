using System.Text.Json;

namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class MachineChamber
{
    public Guid Id { get; set; }
    public Guid MachineId { get; set; }
    public int Number { get; set; }
    public bool Installed { get; set; }
    public required string Stage { get; set; }
}

public sealed class MachineEquipmentHistory
{
    public Guid Id { get; set; }
    public Guid MachineId { get; set; }
    public int? ChamberNumber { get; set; }
    public required string Kind { get; set; }
    public required string Actor { get; set; }
    public required string Reason { get; set; }
    public required string CorrelationId { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
    public required JsonDocument Details { get; set; }
}

// Append-only facts: a null version explicitly returns this component to whole-machine inheritance.
public sealed class MachineChamberVersion
{
    public Guid Id { get; set; }
    public Guid ChamberId { get; set; }
    public Guid ComponentId { get; set; }
    public Guid? VersionId { get; set; }
    public Guid? RevisionId { get; set; }
    public bool IsUnknown { get; set; }
    public DateTimeOffset? EffectiveAt { get; set; }
    public DateTimeOffset? KnownInstalledAt { get; set; }
    public long Sequence { get; set; }
    public Guid HistoryId { get; set; }
}
