namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class LaboratoryValidation
{
    public Guid Id { get; set; }
    public Guid ComponentVersionId { get; set; }
    public Guid MachineId { get; set; }
    public int? ChamberNumber { get; set; }
    public string Result { get; set; } = "InProgress";
    public DateTimeOffset OccurredAt { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
    public string Actor { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public string CorrelationId { get; set; } = string.Empty;
    public Guid EvidenceId { get; set; }
    public string EvidenceKind { get; set; } = string.Empty;
    public string MachineStage { get; set; } = string.Empty;
    public string? ChamberStage { get; set; }
}
