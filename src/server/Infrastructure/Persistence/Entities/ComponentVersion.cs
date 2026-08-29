namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class ComponentVersion
{
    public Guid Id { get; set; }
    public Guid ComponentId { get; set; }
    public required string VersionNumber { get; set; }
    public required string NormalizedVersionNumber { get; set; }
    public long SequenceNo { get; set; }
    public VersionMaturity Maturity { get; set; } = VersionMaturity.Draft;
    public VersionSafety Safety { get; set; } = VersionSafety.Clear;
    public DateTimeOffset CreatedAt { get; set; }
}

public enum VersionMaturity
{
    Draft,
    Testing,
    Released,
    Maintenance,
    Deprecated
}

public enum VersionSafety
{
    Clear,
    Blocked
}
