namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class BaselineSeries
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public required string SeriesCode { get; set; }
    public required string NormalizedSeriesCode { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
