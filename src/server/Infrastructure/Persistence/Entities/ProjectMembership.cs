namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class ProjectMembership
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid UserId { get; set; }
    public ProjectMembershipRole Role { get; set; }
    public required string AssignedBy { get; set; }
    public required string Reason { get; set; }
    public DateTimeOffset AssignedAt { get; set; }
}

public enum ProjectMembershipRole
{
    Viewer,
    Engineer,
    SeniorEngineer
}
