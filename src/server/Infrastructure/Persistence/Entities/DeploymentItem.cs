namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class DeploymentItem
{
    public Guid Id { get; set; }
    public Guid DeploymentBatchId { get; set; }
    public Guid ConfigurationComponentId { get; set; }
    public Guid? NewComponentVersionId { get; set; }
    public DeploymentItemResult Result { get; set; } = DeploymentItemResult.Succeeded;
    public DateTimeOffset? KnownInstalledAt { get; set; }
}

public enum DeploymentItemResult { Succeeded, Failed, Skipped, Absent }
