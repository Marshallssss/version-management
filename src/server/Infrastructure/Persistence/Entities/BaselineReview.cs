namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class BaselineReview
{
    public Guid Id { get; set; }
    public Guid ConfigurationBaselineId { get; set; }
    public BaselineReviewStatus Status { get; set; } = BaselineReviewStatus.Pending;
    public required string RequestedBy { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public required string RequestReason { get; set; }
    public string? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionReason { get; set; }
}

public enum BaselineReviewStatus
{
    Pending,
    Approved,
    Rejected
}
