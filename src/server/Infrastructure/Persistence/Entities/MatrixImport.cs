using System.Text.Json;

namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class MatrixImportTemplate
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string CreatedBy { get; set; }
    public string? ReferenceBaselineCode { get; set; }
    public required JsonDocument Components { get; set; }
}

public sealed class MatrixImportSource
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TemplateId { get; set; }
    public required string Path { get; set; }
    public required string LocalTime { get; set; }
    public required string TimeZoneId { get; set; }
    public bool Enabled { get; set; }
    public Guid AuthorizedByUserId { get; set; }
    public DateTimeOffset NextScanAt { get; set; }
    public DateTimeOffset? LastScanAt { get; set; }
    public required string LastStatus { get; set; }
}

public sealed class MatrixImportRun
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TemplateId { get; set; }
    public Guid? SourceId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string FileName { get; set; }
    public required string Status { get; set; }
    public required string Actor { get; set; }
    public int ImportedCount { get; set; }
    public int SkippedCount { get; set; }
    public required JsonDocument Messages { get; set; }
}

public sealed class MatrixImportCombination
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid TemplateId { get; set; }
    public Guid RunId { get; set; }
    public required string RowKey { get; set; }
    public int SourceRow { get; set; }
    public long SequenceNo { get; set; }
    public required string ContentHash { get; set; }
    public required string RecordDate { get; set; }
    public required string Reason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required JsonDocument Items { get; set; }
}

public sealed class MatrixImportReference
{
    public Guid Id { get; set; }
    public Guid TemplateId { get; set; }
    public Guid? CombinationId { get; set; }
    public Guid ComponentId { get; set; }
    public Guid? VersionId { get; set; }
}
