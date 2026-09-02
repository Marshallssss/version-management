namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class BaselineItem
{
    public Guid Id { get; set; }
    public Guid ConfigurationBaselineId { get; set; }
    public Guid ConfigurationComponentId { get; set; }
    public Guid? ComponentVersionId { get; set; }
    public string? VersionNumberSnapshot { get; set; }
    public Guid? ParentBaselineItemId { get; set; }
    public required string ComponentCodeSnapshot { get; set; }
    public required string ComponentNameSnapshot { get; set; }
    public required string LineageKeySnapshot { get; set; }
    public int SortOrder { get; set; }
    public BaselineItemRequirement Requirement { get; set; } = BaselineItemRequirement.Required;
}

public enum BaselineItemRequirement
{
    Required,
    Optional
}
