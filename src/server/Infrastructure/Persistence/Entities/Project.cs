namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class Project
{
    public Guid Id { get; set; }
    public required string Code { get; set; }
    public required string NormalizedCode { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public ProjectStatus Status { get; set; } = ProjectStatus.Active;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public enum ProjectStatus
{
    Active,
    Archived
}
