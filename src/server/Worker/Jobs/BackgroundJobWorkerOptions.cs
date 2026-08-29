namespace ConfigHub.Worker.Jobs;

public sealed class BackgroundJobWorkerOptions
{
    public const string SectionName = "BackgroundJobs";

    public int PollIntervalSeconds { get; init; } = 5;

    public int LeaseTimeoutMinutes { get; init; } = 15;

    public int MaximumAttempts { get; init; } = 5;
}
