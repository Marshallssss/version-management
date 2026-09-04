namespace ConfigHub.Infrastructure.Persistence.Entities;

public sealed class Machine
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public required string SerialNumber { get; set; }
    public required string NormalizedSerialNumber { get; set; }
    public required string Name { get; set; }
    public string? MachineType { get; set; }
    public string? Location { get; set; }
    public MachineStatus Status { get; set; } = MachineStatus.Active;
    public DateTimeOffset CreatedAt { get; set; }
}

public enum MachineStatus { Active, Archived }
