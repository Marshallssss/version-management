namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class VersionExposureSnapshot
{
    public Guid Id { get; set; }
    public Guid ComponentVersionId { get; set; }
    public DateTimeOffset BlockedAt { get; set; }
    public required string BlockedBy { get; set; }
    public required string Reason { get; set; }
}

public sealed class VersionExposureMachine
{
    public Guid Id { get; set; }
    public Guid VersionExposureSnapshotId { get; set; }
    public Guid MachineId { get; set; }
    public VersionExposureMachineRole Role { get; set; }
}

public sealed class VersionExposureBaseline
{
    public Guid Id { get; set; }
    public Guid VersionExposureSnapshotId { get; set; }
    public Guid ConfigurationBaselineId { get; set; }
}

public enum VersionExposureMachineRole { Current, Target, Historical }
