using System.Text.Json;

namespace ConfigHub.Infrastructure.Persistence.Entities;

// Immutable installable configuration. A missing revision in older facts means unknown, not revision zero.
public sealed class ComponentVersionRevision
{
    public Guid Id { get; set; }
    public Guid ComponentVersionId { get; set; }
    public int RevisionNo { get; set; }
    public required JsonDocument Patches { get; set; }
    public required string Reason { get; set; }
    public required string Actor { get; set; }
    public required string CorrelationId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
