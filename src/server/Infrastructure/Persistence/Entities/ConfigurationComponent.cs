namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class ConfigurationComponent
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid? ParentComponentId { get; set; }
    public required string ComponentCode { get; set; }
    public required string NormalizedComponentCode { get; set; }
    public required string LineageKey { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
