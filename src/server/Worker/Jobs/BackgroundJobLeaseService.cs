using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Worker.Jobs;

public sealed class BackgroundJobLeaseService(
    IDbContextFactory<ConfigHubDbContext> contextFactory,
    IConfiguration configuration)
{
    private readonly BackgroundJobWorkerOptions _options =
        configuration.GetSection(BackgroundJobWorkerOptions.SectionName)
            .Get<BackgroundJobWorkerOptions>() ?? new BackgroundJobWorkerOptions();

    public async Task<LeasedBackgroundJob?> TryLeaseAsync(
        string workerId,
        CancellationToken cancellationToken)
    {
        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var staleBefore = DateTimeOffset.UtcNow.AddMinutes(-_options.LeaseTimeoutMinutes);

        var job = await database.BackgroundJobs
            .FromSqlInterpolated($"""
                SELECT *
                FROM background_jobs
                WHERE
                    (status = 'Pending' AND available_at <= {DateTimeOffset.UtcNow})
                    OR (status = 'Processing' AND locked_at < {staleBefore})
                ORDER BY available_at, created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """)
            .SingleOrDefaultAsync(cancellationToken);

        if (job is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        job.Status = BackgroundJobStatus.Processing;
        job.LockedAt = DateTimeOffset.UtcNow;
        job.LockedBy = workerId;
        job.Attempts += 1;
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new LeasedBackgroundJob(
            job.Id,
            job.JobType,
            job.Payload.RootElement.Clone(),
            job.Attempts);
    }

    public async Task CompleteAsync(
        Guid jobId,
        string workerId,
        CancellationToken cancellationToken)
    {
        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var job = await FindOwnedJobAsync(database, jobId, workerId, cancellationToken);
        job.Status = BackgroundJobStatus.Completed;
        job.CompletedAt = DateTimeOffset.UtcNow;
        job.LockedAt = null;
        job.LockedBy = null;
        job.LastError = null;
        await database.SaveChangesAsync(cancellationToken);
    }

    public async Task FailAsync(
        Guid jobId,
        string workerId,
        Exception exception,
        CancellationToken cancellationToken)
    {
        await using var database = await contextFactory.CreateDbContextAsync(cancellationToken);
        var job = await FindOwnedJobAsync(database, jobId, workerId, cancellationToken);
        var shouldRetry = job.Attempts < _options.MaximumAttempts;

        job.Status = shouldRetry ? BackgroundJobStatus.Pending : BackgroundJobStatus.Failed;
        job.AvailableAt = shouldRetry
            ? DateTimeOffset.UtcNow.AddSeconds(Math.Min(300, Math.Pow(2, job.Attempts)))
            : job.AvailableAt;
        job.CompletedAt = shouldRetry ? null : DateTimeOffset.UtcNow;
        job.LockedAt = null;
        job.LockedBy = null;
        job.LastError = exception.ToString()[..Math.Min(exception.ToString().Length, 4000)];
        await database.SaveChangesAsync(cancellationToken);
    }

    private static async Task<BackgroundJob> FindOwnedJobAsync(
        ConfigHubDbContext database,
        Guid jobId,
        string workerId,
        CancellationToken cancellationToken)
    {
        return await database.BackgroundJobs.SingleOrDefaultAsync(
                job => job.Id == jobId
                    && job.Status == BackgroundJobStatus.Processing
                    && job.LockedBy == workerId,
                cancellationToken)
            ?? throw new InvalidOperationException($"Background job {jobId} is no longer leased by this worker.");
    }
}

public sealed record LeasedBackgroundJob(
    Guid Id,
    string JobType,
    JsonElement Payload,
    int Attempt);
