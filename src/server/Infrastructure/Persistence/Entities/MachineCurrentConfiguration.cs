namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class MachineCurrentConfiguration
{
    public Guid MachineId { get; set; }
    public Guid ConfigurationComponentId { get; set; }
    public Guid? ComponentVersionId { get; set; }
    public CurrentConfigurationState State { get; set; } = CurrentConfigurationState.Present;
    public DateTimeOffset StateEffectiveAt { get; set; }
    public DateTimeOffset? KnownInstalledAt { get; set; }
    public Guid SourceDeploymentItemId { get; set; }
}

public enum CurrentConfigurationState { Present, Absent }
