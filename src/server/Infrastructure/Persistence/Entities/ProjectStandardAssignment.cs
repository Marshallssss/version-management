namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class ProjectStandardAssignment
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid ConfigurationBaselineId { get; set; }
    public DateTimeOffset ValidFrom { get; set; }
    public DateTimeOffset? ValidTo { get; set; }
    public required string AssignedBy { get; set; }
    public required string Reason { get; set; }
}
