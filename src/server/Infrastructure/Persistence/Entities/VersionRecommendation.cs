namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class VersionRecommendation
{
    public Guid Id { get; set; }
    public Guid ComponentId { get; set; }
    public Guid ComponentVersionId { get; set; }
    public required string AssignedBy { get; set; }
    public required string Reason { get; set; }
    public DateTimeOffset AssignedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevokedBy { get; set; }
    public string? RevokeReason { get; set; }
}
