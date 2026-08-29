namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class MachineTargetAssignment
{
    public Guid Id { get; set; }
    public Guid MachineId { get; set; }
    public Guid ConfigurationBaselineId { get; set; }
    public DateTimeOffset ValidFrom { get; set; }
    public DateTimeOffset? ValidTo { get; set; }
    public required string AssignedBy { get; set; }
    public required string Reason { get; set; }
}
