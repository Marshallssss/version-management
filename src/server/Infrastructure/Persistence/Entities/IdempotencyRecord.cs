using System.Text.Json;

namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class IdempotencyRecord
{
    public Guid Id { get; set; }

    public required string Scope { get; set; }

    public required string IdempotencyKey { get; set; }

    public required string RequestHash { get; set; }

    public IdempotencyRecordStatus Status { get; set; } = IdempotencyRecordStatus.InProgress;

    public JsonDocument? Result { get; set; }

    public string? Reference { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
}

public enum IdempotencyRecordStatus
{
    InProgress,
    Completed,
    Failed
}
