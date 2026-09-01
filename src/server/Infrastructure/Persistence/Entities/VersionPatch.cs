namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class VersionPatch
{
    public Guid Id { get; set; }
    public Guid ComponentVersionId { get; set; }
    public required string PatchCode { get; set; }
    public required string NormalizedPatchCode { get; set; }
    public required string Title { get; set; }
    public required string IssueDescription { get; set; }
    public required string ResolutionDescription { get; set; }
    public VersionPatchStatus Status { get; set; } = VersionPatchStatus.Released;
    public required string RecordedBy { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
}

public enum VersionPatchStatus
{
    Draft,
    Released,
    Withdrawn
}
