namespace ConfigHub.Worker.Jobs;

public sealed class BackgroundJobWorker(
    BackgroundJobLeaseService leaseService,
    IEnumerable<IBackgroundJobHandler> handlers,
    IConfiguration configuration,
    ILogger<BackgroundJobWorker> logger) : BackgroundService
{
    private readonly IReadOnlyDictionary<string, IBackgroundJobHandler> _handlers =
        handlers.ToDictionary(handler => handler.JobType, StringComparer.OrdinalIgnoreCase);

    private readonly BackgroundJobWorkerOptions _options =
        configuration.GetSection(BackgroundJobWorkerOptions.SectionName)
            .Get<BackgroundJobWorkerOptions>() ?? new BackgroundJobWorkerOptions();

    private readonly string _workerId = $"{Environment.MachineName}:{Environment.ProcessId}";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ConfigHub background worker {WorkerId} started.", _workerId);

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
                logger.LogError(exception, "Background job polling failed.");
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
            logger.LogInformation("Completed background job {JobId} ({JobType}).", job.Id, job.JobType);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Background job {JobId} ({JobType}) failed on attempt {Attempt}.",
                job.Id,
                job.JobType,
                job.Attempt);
            await leaseService.FailAsync(job.Id, _workerId, exception, cancellationToken);
        }
    }
}
