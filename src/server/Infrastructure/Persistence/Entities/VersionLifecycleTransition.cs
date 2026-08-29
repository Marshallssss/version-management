namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class VersionLifecycleTransition
{
    public Guid Id { get; set; }
    public Guid ComponentVersionId { get; set; }
    public LifecycleAxis Axis { get; set; }
    public required string FromState { get; set; }
    public required string ToState { get; set; }
    public required string Reason { get; set; }
    public required string Actor { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public enum LifecycleAxis
{
    Maturity,
    Safety
}
