namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class DeploymentBatch
{
    public Guid Id { get; set; }
    public Guid MachineId { get; set; }
    public DeploymentOperationType OperationType { get; set; }
    public ObservationCoverage Coverage { get; set; }
    public required string SourceType { get; set; }
    public string? ExternalEventId { get; set; }
    public Guid? CorrectsDeploymentBatchId { get; set; }
    public Guid? SourceConfigurationBaselineId { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
    public DateTimeOffset EffectiveAt { get; set; }
}

public enum DeploymentOperationType { Install, Upgrade, InitialSnapshot, Observation, Rollback, Correction }
public enum ObservationCoverage { Full, Partial }
