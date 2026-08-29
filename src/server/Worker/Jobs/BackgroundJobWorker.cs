namespace ConfigHub.Worker.Jobs;

public sealed partial class BackgroundJobWorker(
    BackgroundJobLeaseService leaseService,
    IEnumerable<IBackgroundJobHandler> handlers,
    IConfiguration configuration,
    ILogger<BackgroundJobWorker> logger) : BackgroundService
{
    private readonly Dictionary<string, IBackgroundJobHandler> _handlers =
        handlers.ToDictionary(handler => handler.JobType, StringComparer.OrdinalIgnoreCase);

    private readonly BackgroundJobWorkerOptions _options =
        configuration.GetSection(BackgroundJobWorkerOptions.SectionName)
            .Get<BackgroundJobWorkerOptions>() ?? new BackgroundJobWorkerOptions();

    private readonly string _workerId = $"{Environment.MachineName}:{Environment.ProcessId}";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        LogWorkerStarted(logger, _workerId);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var job = await leaseService.TryLeaseAsync(_workerId, stoppingToken);
                if (job is null)
                {
                    await Task.Delay(TimeSpan.FromSeconds(_options.PollIntervalSeconds), stoppingToken);
                    continue;
                }

                await ProcessAsync(job, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                LogPollingFailed(logger, exception);
                await Task.Delay(TimeSpan.FromSeconds(_options.PollIntervalSeconds), stoppingToken);
            }
        }
    }

    private async Task ProcessAsync(LeasedBackgroundJob job, CancellationToken cancellationToken)
    {
        try
        {
            if (!_handlers.TryGetValue(job.JobType, out var handler))
            {
                throw new InvalidOperationException($"No handler is registered for background job type '{job.JobType}'.");
            }

            await handler.HandleAsync(job.Payload, cancellationToken);
            await leaseService.CompleteAsync(job.Id, _workerId, cancellationToken);
            LogJobCompleted(logger, job.Id, job.JobType);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogJobFailed(logger, exception, job.Id, job.JobType, job.Attempt);
            await leaseService.FailAsync(job.Id, _workerId, exception, cancellationToken);
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "ConfigHub background worker {WorkerId} started.")]
    private static partial void LogWorkerStarted(ILogger logger, string workerId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Background job polling failed.")]
    private static partial void LogPollingFailed(ILogger logger, Exception exception);

    [LoggerMessage(Level = LogLevel.Information, Message = "Completed background job {JobId} ({JobType}).")]
    private static partial void LogJobCompleted(ILogger logger, Guid jobId, string jobType);

    [LoggerMessage(Level = LogLevel.Error, Message = "Background job {JobId} ({JobType}) failed on attempt {Attempt}.")]
    private static partial void LogJobFailed(
        ILogger logger,
        Exception exception,
        Guid jobId,
        string jobType,
        int attempt);
}
