using System.Text.Json;

namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class BackgroundJob
{
    public Guid Id { get; set; }

    public required string JobType { get; set; }

    public required JsonDocument Payload { get; set; }

    public BackgroundJobStatus Status { get; set; } = BackgroundJobStatus.Pending;

    public DateTimeOffset AvailableAt { get; set; }

    public DateTimeOffset? LockedAt { get; set; }

    public string? LockedBy { get; set; }

    public int Attempts { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public string? LastError { get; set; }
}

public enum BackgroundJobStatus
{
    Pending,
    Running,
    Succeeded,
    Failed,
    Retry
}
