using System.Text.Json;

namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class ImportBatch
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public required string SourceFileName { get; set; }
    public ImportBatchStatus Status { get; set; } = ImportBatchStatus.Staged;
    public required string CreatedBy { get; set; }
    public required string Reason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ImportRow
{
    public Guid Id { get; set; }
    public Guid ImportBatchId { get; set; }
    public int RowNumber { get; set; }
    public required JsonDocument Payload { get; set; }
    public string? ValidationError { get; set; }
}

public enum ImportBatchStatus { Staged, Validated, Committed, Failed }
