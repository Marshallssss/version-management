namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class ConfigurationBaseline
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid BaselineSeriesId { get; set; }
    public Guid? SupersedesBaselineId { get; set; }
    public Guid? TopComponentVersionId { get; set; }
    public required string BaselineCode { get; set; }
    public required string NormalizedBaselineCode { get; set; }
    public int RevisionNo { get; set; }
    public string? Description { get; set; }
    public BaselineState State { get; set; } = BaselineState.Draft;
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? ReleasedBy { get; set; }
    public DateTimeOffset? ReleasedAt { get; set; }
    public string? ReleaseReason { get; set; }
    public string? ApprovedBy { get; set; }
}

public enum BaselineState
{
    Draft,
    Released,
    Deprecated,
    Archived
}
