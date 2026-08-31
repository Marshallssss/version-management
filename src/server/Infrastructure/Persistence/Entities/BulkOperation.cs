namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class BulkOperation
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public BulkOperationType OperationType { get; set; }
    public BulkOperationStatus Status { get; set; } = BulkOperationStatus.Pending;
    public required string RequestedBy { get; set; }
    public required string Reason { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public sealed class BulkOperationItem
{
    public Guid Id { get; set; }
    public Guid BulkOperationId { get; set; }
    public Guid MachineId { get; set; }
    public BulkOperationItemStatus Status { get; set; }
    public string? Detail { get; set; }
}

public enum BulkOperationType { MachineTargetAssignment }
public enum BulkOperationStatus { Pending, Running, Succeeded, Failed }
public enum BulkOperationItemStatus { Succeeded, Skipped, Failed }
