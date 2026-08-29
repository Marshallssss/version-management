using System.Text.Json;

namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class AuditEvent
{
    public Guid Id { get; set; }
    public required string Actor { get; set; }
    public required string Action { get; set; }
    public required string EntityType { get; set; }
    public Guid EntityId { get; set; }
    public required string CorrelationId { get; set; }
    public JsonDocument? Data { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
